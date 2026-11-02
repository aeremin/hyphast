// Data model and graph helpers shared by the web app (src/lib/model.ts re-exports this file)
// and the MCP server. Keep it free of imports so both builds can use it as is.

export type NodeKind = "area" | "project" | "task";
export type NodeStatus = "todo" | "in_progress" | "done" | "dropped";

export const NODE_KINDS: NodeKind[] = ["area", "project", "task"];
export const NODE_STATUSES: NodeStatus[] = ["todo", "in_progress", "done", "dropped"];

export const STATUS_LABELS: Record<NodeStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
};

// Keep in sync with validNode() in firestore.rules.
export const MAX_TITLE = 500;
export const MAX_NOTES = 50000;
export const MAX_LINKS = 100;

/** Fields stored in nodes/{id}. Timestamps are Firestore timestamps (or null before the server sets them). */
export interface NodeFields {
  kind: NodeKind;
  title: string;
  notes: string;
  status: NodeStatus;
  /** Area: null. Project: an area. Task: a project or another task (a subtask). */
  parentId: string | null;
  /** Lowercased email of a member, or null. */
  assignee: string | null;
  /** YYYY-MM-DD or null. */
  due: string | null;
  /** Ids of nodes that must be finished before this one. */
  blockedBy: string[];
  /** Ids of loosely related nodes. Stored on one side only; the link is undirected. */
  related: string[];
  createdBy: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
  completedAt: unknown;
}

export interface GraphNode extends Pick<
  NodeFields,
  "kind" | "title" | "notes" | "status" | "parentId" | "assignee" | "due" | "blockedBy" | "related"
> {
  id: string;
  /** Milliseconds since epoch; used to keep sibling order stable. */
  createdMs: number;
}

export function isOpen(status: NodeStatus): boolean {
  return status === "todo" || status === "in_progress";
}

/** The kind a new child of `parent` gets (null parent → area). */
export function childKind(parent: GraphNode | null): NodeKind {
  if (!parent) return "area";
  return parent.kind === "area" ? "project" : "task";
}

/** Returns an error message if `kind` can't be placed under `parent`. */
export function parentError(kind: NodeKind, parent: GraphNode | null): string | null {
  if (kind === "area") return parent ? "Areas can't have a parent" : null;
  if (!parent) return `A ${kind} needs a parent`;
  if (kind === "project" && parent.kind !== "area") return "A project's parent must be an area";
  if (kind === "task" && parent.kind === "area") return "A task's parent must be a project or another task";
  return null;
}

export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

export class Graph {
  readonly byId = new Map<string, GraphNode>();
  private readonly childrenOf = new Map<string | null, GraphNode[]>();
  private readonly blocking = new Map<string, GraphNode[]>();
  private readonly relatedTo = new Map<string, Set<string>>();

  constructor(nodes: GraphNode[]) {
    const sorted = [...nodes].sort((a, b) => a.createdMs - b.createdMs || a.id.localeCompare(b.id));
    for (const n of sorted) this.byId.set(n.id, n);
    for (const n of sorted) {
      // Orphans (parent deleted elsewhere) show up as roots rather than vanishing.
      const parent = n.parentId && this.byId.has(n.parentId) ? n.parentId : null;
      push(this.childrenOf, parent, n);
      for (const b of n.blockedBy) push(this.blocking, b, n);
      for (const r of n.related) {
        if (!this.byId.has(r)) continue;
        addTo(this.relatedTo, n.id, r);
        addTo(this.relatedTo, r, n.id);
      }
    }
  }

  get nodes(): GraphNode[] {
    return [...this.byId.values()];
  }

  get(id: string | null | undefined): GraphNode | null {
    return (id && this.byId.get(id)) || null;
  }

  children(id: string | null): GraphNode[] {
    return this.childrenOf.get(id) ?? [];
  }

  roots(): GraphNode[] {
    return this.children(null);
  }

  parent(n: GraphNode): GraphNode | null {
    return this.get(n.parentId);
  }

  /** Ancestors from the root down to the direct parent. */
  ancestors(n: GraphNode): GraphNode[] {
    const out: GraphNode[] = [];
    const seen = new Set<string>([n.id]);
    let p = this.parent(n);
    while (p && !seen.has(p.id)) {
      out.unshift(p);
      seen.add(p.id);
      p = this.parent(p);
    }
    return out;
  }

  path(n: GraphNode): string {
    return [...this.ancestors(n), n].map((a) => a.title).join(" › ");
  }

  descendants(id: string): GraphNode[] {
    const out: GraphNode[] = [];
    const stack = [...this.children(id)];
    while (stack.length) {
      const n = stack.pop() as GraphNode;
      out.push(n);
      stack.push(...this.children(n.id));
    }
    return out;
  }

  isDescendant(id: string, ancestorId: string): boolean {
    const n = this.get(id);
    return !!n && this.ancestors(n).some((a) => a.id === ancestorId);
  }

  /** Nodes listing `id` in their blockedBy. */
  blocks(id: string): GraphNode[] {
    return this.blocking.get(id) ?? [];
  }

  blockers(n: GraphNode): GraphNode[] {
    return n.blockedBy.map((b) => this.get(b)).filter((b): b is GraphNode => !!b);
  }

  openBlockers(n: GraphNode): GraphNode[] {
    return this.blockers(n).filter((b) => this.isEffectivelyOpen(b));
  }

  relatedNodes(id: string): GraphNode[] {
    return [...(this.relatedTo.get(id) ?? [])].map((r) => this.byId.get(r) as GraphNode);
  }

  /** Open and not under a done/dropped ancestor. */
  isEffectivelyOpen(n: GraphNode): boolean {
    return isOpen(n.status) && this.ancestors(n).every((a) => isOpen(a.status));
  }

  /**
   * A task that can be worked on right now: effectively open, no unfinished blockers
   * (on itself or its ancestors) and no unfinished subtasks.
   */
  isActionable(n: GraphNode): boolean {
    if (n.kind !== "task" || !this.isEffectivelyOpen(n)) return false;
    if ([n, ...this.ancestors(n)].some((a) => this.openBlockers(a).length > 0)) return false;
    return !this.children(n.id).some((c) => isOpen(c.status));
  }

  isBlocked(n: GraphNode): boolean {
    return this.isEffectivelyOpen(n) && this.openBlockers(n).length > 0;
  }

  /** Would making `id` blocked by `blockerId` create a dependency cycle? */
  wouldCycle(id: string, blockerId: string): boolean {
    if (id === blockerId) return true;
    // A cycle exists if `id` is (transitively) a blocker of `blockerId`.
    const seen = new Set<string>();
    const stack = [blockerId];
    while (stack.length) {
      const cur = this.get(stack.pop());
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      for (const b of cur.blockedBy) {
        if (b === id) return true;
        stack.push(b);
      }
    }
    return false;
  }

  /** Returns an error message if `id` can't be moved under `newParentId`. */
  moveError(id: string, newParentId: string | null): string | null {
    const n = this.get(id);
    if (!n) return "Node not found";
    const parent = this.get(newParentId);
    if (newParentId && !parent) return "Parent not found";
    if (parent && (parent.id === id || this.isDescendant(parent.id, id))) {
      return "Can't move a node under itself";
    }
    return parentError(n.kind, parent);
  }

  /** Counts of open/total tasks below `id`. */
  taskCounts(id: string): { open: number; total: number } {
    let open = 0;
    let total = 0;
    for (const d of this.descendants(id)) {
      if (d.kind !== "task") continue;
      total++;
      if (isOpen(d.status)) open++;
    }
    return {open, total};
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function addTo(map: Map<string, Set<string>>, key: string, value: string) {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}
