import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { childKind, isOpen, type Graph, type GraphNode, type NodeStatus } from './model';

// Writes from the web app. Firestore's offline cache applies them locally right away, so the UI
// doesn't wait for them; failures are reported here.

const nodesCol = collection(db, 'nodes');

function meta(me: string) {
  return { updatedBy: me, updatedAt: serverTimestamp() };
}

function report(err: unknown) {
  console.error(err);
  alert(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
}

/**
 * Creates a child of `parent` (an area when parent is null) and returns its id. Siblings are ordered
 * by createdAt, which is set on the client so that nodes created together keep their `order`.
 */
export function createNode(me: string, parent: GraphNode | null, title: string, order = 0) {
  const ref = doc(nodesCol);
  setDoc(ref, {
    kind: childKind(parent),
    title: title.trim(),
    notes: '',
    status: 'todo',
    parentId: parent?.id ?? null,
    assignee: null,
    due: null,
    blockedBy: [],
    related: [],
    createdBy: me,
    createdAt: Timestamp.fromMillis(Date.now() + order),
    completedAt: null,
    ...meta(me),
  }).catch(report);
  return ref.id;
}

export type NodePatch = Partial<Pick<GraphNode, 'title' | 'notes' | 'status' | 'assignee' | 'due' | 'parentId'>>;

export function updateNode(me: string, id: string, patch: NodePatch) {
  const fields: Record<string, unknown> = { ...patch, ...meta(me) };
  if (patch.status) fields.completedAt = isOpen(patch.status) ? null : serverTimestamp();
  updateDoc(doc(nodesCol, id), fields).catch(report);
}

export function setStatus(me: string, id: string, status: NodeStatus) {
  updateNode(me, id, { status });
}

/** Makes `id` blocked by `blockerId`; returns an error message instead if that would make a cycle. */
export function addBlocker(me: string, graph: Graph, id: string, blockerId: string): string | null {
  if (graph.wouldCycle(id, blockerId)) return 'That would create a dependency cycle';
  updateDoc(doc(nodesCol, id), { blockedBy: arrayUnion(blockerId), ...meta(me) }).catch(report);
  return null;
}

export function removeBlocker(me: string, id: string, blockerId: string) {
  updateDoc(doc(nodesCol, id), { blockedBy: arrayRemove(blockerId), ...meta(me) }).catch(report);
}

export function addRelated(me: string, graph: Graph, id: string, otherId: string) {
  if (id === otherId || graph.relatedNodes(id).some((r) => r.id === otherId)) return;
  updateDoc(doc(nodesCol, id), { related: arrayUnion(otherId), ...meta(me) }).catch(report);
}

/** Related links are stored on one side, which may be either, so clear both. */
export function removeRelated(me: string, graph: Graph, id: string, otherId: string) {
  const batch = writeBatch(db);
  for (const [a, b] of [[id, otherId], [otherId, id]]) {
    if (graph.get(a)?.related.includes(b)) batch.update(doc(nodesCol, a), { related: arrayRemove(b), ...meta(me) });
  }
  batch.commit().catch(report);
}

/** Deletes a node with everything below it, and removes links to them from other nodes. */
export function deleteSubtree(me: string, graph: Graph, id: string) {
  const doomed = new Set([id, ...graph.descendants(id).map((d) => d.id)]);
  const batch = writeBatch(db);
  for (const d of doomed) batch.delete(doc(nodesCol, d));
  for (const n of graph.nodes) {
    if (doomed.has(n.id)) continue;
    const blockedBy = n.blockedBy.filter((b) => !doomed.has(b));
    const related = n.related.filter((r) => !doomed.has(r));
    if (blockedBy.length !== n.blockedBy.length || related.length !== n.related.length) {
      batch.update(doc(nodesCol, n.id), { blockedBy, related, ...meta(me) });
    }
  }
  batch.commit().catch(report);
}
