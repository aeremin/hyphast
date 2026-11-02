import {getFirestore, FieldValue, Timestamp, type Firestore} from "firebase-admin/firestore";
import {
  Graph, childKind, isOpen, isValidDate, parentError,
  MAX_LINKS, MAX_NOTES, MAX_TITLE,
  type GraphNode, type NodeKind, type NodeStatus,
} from "./model.js";

export const OWNER_EMAIL = "a.eremin.msu@gmail.com";

export interface Member {
  email: string;
  name: string;
}

export class UserError extends Error {}

function db(): Firestore {
  return getFirestore();
}

export async function loadGraph(): Promise<Graph> {
  const snap = await db().collection("nodes").get();
  return new Graph(snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      kind: data.kind,
      title: data.title,
      notes: data.notes ?? "",
      status: data.status,
      parentId: data.parentId ?? null,
      assignee: data.assignee ?? null,
      due: data.due ?? null,
      blockedBy: data.blockedBy ?? [],
      related: data.related ?? [],
      createdMs: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0,
    };
  }));
}

export async function loadMembers(): Promise<Member[]> {
  const snap = await db().collection("members").get();
  const members = snap.docs.map((d) => ({email: d.id, name: (d.get("name") as string) || d.id}));
  if (!members.some((m) => m.email === OWNER_EMAIL)) members.unshift({email: OWNER_EMAIL, name: OWNER_EMAIL});
  return members;
}

/** Looks up the member an API token belongs to; null if the token is unknown or its owner was removed. */
export async function authenticate(tokenHash: string): Promise<string | null> {
  const ref = db().collection("apiTokens").doc(tokenHash);
  const token = await ref.get();
  if (!token.exists) return null;
  const email = token.get("email") as string;
  if (email !== OWNER_EMAIL && !(await db().collection("members").doc(email).get()).exists) return null;
  await ref.update({lastUsedAt: FieldValue.serverTimestamp()});
  return email;
}

/** Resolves "me", an email or a member's name (case-insensitive prefix) to an email. */
export function resolveAssignee(value: string | null | undefined, me: string, members: Member[]): string | null {
  if (value == null || value === "") return null;
  const v = value.trim().toLowerCase();
  if (v === "me") return me;
  const match = members.find((m) => m.email === v) ??
    members.find((m) => m.name.toLowerCase() === v) ??
    members.find((m) => m.name.toLowerCase().startsWith(v) || m.email.startsWith(v));
  if (!match) throw new UserError(`Unknown assignee "${value}". Members: ${members.map((m) => m.email).join(", ")}`);
  return match.email;
}

function checkTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new UserError("Title can't be empty");
  if (t.length > MAX_TITLE) throw new UserError(`Title is longer than ${MAX_TITLE} characters`);
  return t;
}

function checkNotes(notes: string): string {
  if (notes.length > MAX_NOTES) throw new UserError(`Notes are longer than ${MAX_NOTES} characters`);
  return notes;
}

function checkDue(due: string | null | undefined): string | null {
  if (due == null || due === "") return null;
  if (!isValidDate(due)) throw new UserError(`Invalid due date "${due}", expected YYYY-MM-DD`);
  return due;
}

function statusFields(status: NodeStatus) {
  return {status, completedAt: isOpen(status) ? null : FieldValue.serverTimestamp()};
}

export interface NewNode {
  ref?: string;
  kind?: NodeKind;
  title: string;
  parent?: string;
  notes?: string;
  status?: NodeStatus;
  assignee?: string | null;
  due?: string | null;
  blockedBy?: string[];
  related?: string[];
}

/**
 * Creates nodes in one batch. `parent`, `blockedBy` and `related` may name existing ids or the `ref`
 * of another node in the same call, so a whole project with its tasks and dependencies can be
 * created at once. Returns the created nodes in input order.
 */
export async function createNodes(items: NewNode[], me: string): Promise<GraphNode[]> {
  if (items.length === 0) return [];
  if (items.length > 400) throw new UserError("At most 400 nodes per call");
  const graph = await loadGraph();
  const members = await loadMembers();
  const col = db().collection("nodes");
  const ids = new Map<string, string>();
  for (const item of items) {
    if (!item.ref) continue;
    if (ids.has(item.ref) || graph.byId.has(item.ref)) throw new UserError(`Duplicate ref "${item.ref}"`);
    ids.set(item.ref, col.doc().id);
  }
  const resolve = (r: string) => ids.get(r) ?? (graph.byId.has(r) ? r : null);

  // Build all new nodes first so parents and links among them can be validated together.
  const created: GraphNode[] = [];
  const now = Date.now();
  for (const [i, item] of items.entries()) {
    const id = (item.ref && ids.get(item.ref)) || col.doc().id;
    const parentId = item.parent ? resolve(item.parent) : null;
    if (item.parent && !parentId) throw new UserError(`Item ${i} ("${item.title}"): unknown parent "${item.parent}"`);
    const links = (list: string[] | undefined, what: string) => (list ?? []).map((r) => {
      const target = resolve(r);
      if (!target) throw new UserError(`Item ${i} ("${item.title}"): unknown ${what} "${r}"`);
      return target;
    });
    created.push({
      id,
      kind: item.kind ?? "task",
      title: checkTitle(item.title),
      notes: checkNotes(item.notes ?? ""),
      status: item.status ?? "todo",
      parentId,
      assignee: resolveAssignee(item.assignee, me, members),
      due: checkDue(item.due),
      blockedBy: [...new Set(links(item.blockedBy, "blocker"))],
      related: [...new Set(links(item.related, "related node"))],
      createdMs: now + i,
    });
  }
  const combined = new Graph([...graph.nodes, ...created]);
  for (const [i, n] of created.entries()) {
    const parent = combined.get(n.parentId);
    if (!items[i].kind) n.kind = childKind(parent);
    const err = parentError(n.kind, parent);
    if (err) throw new UserError(`Item ${i} ("${n.title}"): ${err}`);
    if (n.blockedBy.length > MAX_LINKS || n.related.length > MAX_LINKS) {
      throw new UserError(`Item ${i} ("${n.title}"): too many links`);
    }
  }
  const check = new Graph([...graph.nodes, ...created]);
  for (const n of created) {
    for (const b of n.blockedBy) {
      if (check.wouldCycle(n.id, b)) throw new UserError(`"${n.title}": dependency cycle via "${check.get(b)?.title}"`);
    }
  }

  const batch = db().batch();
  for (const n of created) {
    batch.create(col.doc(n.id), {
      kind: n.kind,
      title: n.title,
      notes: n.notes,
      parentId: n.parentId,
      assignee: n.assignee,
      due: n.due,
      blockedBy: n.blockedBy,
      related: n.related,
      ...statusFields(n.status),
      createdBy: me,
      updatedBy: me,
      // Siblings are ordered by createdAt, so keep the order they were given in.
      createdAt: Timestamp.fromMillis(n.createdMs),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return created;
}

export interface NodeUpdate {
  id: string;
  title?: string;
  notes?: string;
  status?: NodeStatus;
  assignee?: string | null;
  due?: string | null;
  parent?: string;
  addBlockedBy?: string[];
  removeBlockedBy?: string[];
  addRelated?: string[];
  removeRelated?: string[];
}

export async function updateNodes(updates: NodeUpdate[], me: string): Promise<GraphNode[]> {
  if (updates.length > 400) throw new UserError("At most 400 updates per call");
  const graph = await loadGraph();
  const members = await loadMembers();
  // Apply to copies so later updates in the call see earlier ones (moves, new dependencies).
  const working = new Map(graph.nodes.map((n) => [n.id, {...n, blockedBy: [...n.blockedBy], related: [...n.related]}]));
  const touched = new Map<string, Record<string, unknown>>();

  for (const u of updates) {
    const n = working.get(u.id);
    if (!n) throw new UserError(`Unknown node "${u.id}"`);
    const fields = touched.get(u.id) ?? {};
    const need = (id: string) => {
      if (!working.has(id)) throw new UserError(`"${n.title}": unknown node "${id}"`);
      return id;
    };
    if (u.title !== undefined) fields.title = n.title = checkTitle(u.title);
    if (u.notes !== undefined) fields.notes = n.notes = checkNotes(u.notes);
    if (u.status !== undefined) {
      n.status = u.status;
      Object.assign(fields, statusFields(u.status));
    }
    if (u.assignee !== undefined) fields.assignee = n.assignee = resolveAssignee(u.assignee, me, members);
    if (u.due !== undefined) fields.due = n.due = checkDue(u.due);
    if (u.parent !== undefined) {
      const err = new Graph([...working.values()]).moveError(n.id, need(u.parent));
      if (err) throw new UserError(`"${n.title}": ${err}`);
      fields.parentId = n.parentId = u.parent;
    }
    if (u.addBlockedBy || u.removeBlockedBy) {
      const remove = new Set(u.removeBlockedBy ?? []);
      const next = n.blockedBy.filter((b) => !remove.has(b));
      for (const b of u.addBlockedBy ?? []) {
        need(b);
        if (next.includes(b)) continue;
        if (new Graph([...working.values()]).wouldCycle(n.id, b)) {
          throw new UserError(`"${n.title}": blocking it by "${working.get(b)?.title}" would create a cycle`);
        }
        next.push(b);
        n.blockedBy = next;
      }
      fields.blockedBy = n.blockedBy = next;
    }
    if (u.addRelated || u.removeRelated) {
      const remove = new Set(u.removeRelated ?? []);
      const next = n.related.filter((r) => !remove.has(r));
      for (const r of u.addRelated ?? []) {
        need(r);
        if (r !== n.id && !next.includes(r) && !working.get(r)?.related.includes(n.id)) next.push(r);
      }
      fields.related = n.related = next;
      // The link is stored on one side only, so removing it may have to touch the other node.
      for (const r of remove) {
        const other = working.get(r);
        if (!other?.related.includes(n.id)) continue;
        other.related = other.related.filter((x) => x !== n.id);
        touched.set(r, {...(touched.get(r) ?? {}), related: other.related});
      }
    }
    if (n.blockedBy.length > MAX_LINKS || n.related.length > MAX_LINKS) {
      throw new UserError(`"${n.title}": too many links`);
    }
    touched.set(u.id, fields);
  }

  const batch = db().batch();
  for (const [id, fields] of touched) {
    batch.update(db().collection("nodes").doc(id), {...fields, updatedBy: me, updatedAt: FieldValue.serverTimestamp()});
  }
  await batch.commit();
  return [...touched.keys()].map((id) => working.get(id) as GraphNode);
}

/** Deletes nodes (and with `recursive`, everything below them) and removes links pointing at them. */
export async function deleteNodes(ids: string[], recursive: boolean, me: string): Promise<GraphNode[]> {
  const graph = await loadGraph();
  const doomed = new Map<string, GraphNode>();
  for (const id of ids) {
    const n = graph.get(id);
    if (!n) throw new UserError(`Unknown node "${id}"`);
    const below = graph.descendants(id);
    if (below.length && !recursive && below.some((d) => !ids.includes(d.id))) {
      throw new UserError(`"${n.title}" has ${below.length} descendants; pass recursive: true to delete them too`);
    }
    doomed.set(id, n);
    for (const d of below) doomed.set(d.id, d);
  }
  if (doomed.size > 400) throw new UserError("At most 400 nodes per call");
  const batch = db().batch();
  for (const id of doomed.keys()) batch.delete(db().collection("nodes").doc(id));
  for (const n of graph.nodes) {
    if (doomed.has(n.id)) continue;
    const blockedBy = n.blockedBy.filter((b) => !doomed.has(b));
    const related = n.related.filter((r) => !doomed.has(r));
    if (blockedBy.length === n.blockedBy.length && related.length === n.related.length) continue;
    batch.update(db().collection("nodes").doc(n.id), {
      blockedBy, related, updatedBy: me, updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return [...doomed.values()];
}
