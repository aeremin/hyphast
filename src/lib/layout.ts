import { isOpen, type Graph, type GraphNode } from './model';

export interface ViewOptions {
  showClosed: boolean;
  collapsed: Set<string>;
  /** The node shown with what's below it (the selected project); null shows nothing. */
  rootId: string | null;
}

export interface VisibleNode {
  node: GraphNode;
  depth: number;
  /** Nodes below this one hidden because it's collapsed. */
  hiddenCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Visible {
  /** In tree (pre-)order, which keyboard navigation follows. */
  nodes: VisibleNode[];
  byId: Map<string, VisibleNode>;
}

export const NODE_WIDTH = { area: 240, project: 220, task: 210 } as const;

function nodeHeight(n: GraphNode) {
  // Rough fit for the card's text width; titles beyond four lines are clamped.
  const charsPerLine = n.kind === 'area' ? 19 : n.kind === 'project' ? 23 : 21;
  const lines = Math.min(4, Math.max(1, Math.ceil(n.title.length / charsPerLine)));
  const base = n.kind === 'area' ? 46 : n.kind === 'project' ? 42 : 38;
  return base + lines * (n.kind === 'area' ? 22 : 18);
}

function shown(n: GraphNode, opts: ViewOptions) {
  return opts.showClosed || isOpen(n.status);
}

const ROW_GAP = 12;
const TREE_GAP = 40;
const COLUMN_GAP = 64;

/**
 * Left-to-right tidy tree: one column per depth, leaves stacked top to bottom in sibling (creation)
 * order, each parent centred on its children.
 */
export function computeVisible(graph: Graph, opts: ViewOptions): Visible {
  const out: VisibleNode[] = [];
  const kids = new Map<VisibleNode, VisibleNode[]>();
  const root = graph.get(opts.rootId);
  const visit = (n: GraphNode, depth: number): VisibleNode => {
    const collapsed = opts.collapsed.has(n.id);
    const hiddenCount = collapsed ? graph.descendants(n.id).filter((d) => shown(d, opts)).length : 0;
    const v = { node: n, depth, hiddenCount, x: 0, y: 0, width: NODE_WIDTH[n.kind], height: nodeHeight(n) };
    out.push(v);
    const children = collapsed ? [] : graph.children(n.id).filter((c) => shown(c, opts));
    kids.set(v, children.map((c) => visit(c, depth + 1)));
    return v;
  };
  // The root is shown even when it's closed, since it was picked explicitly.
  const roots = root ? [visit(root, 0)] : [];

  const columnX: number[] = [0];
  for (const v of out) {
    const right = v.width + COLUMN_GAP;
    columnX[v.depth + 1] = Math.max(columnX[v.depth + 1] ?? 0, right);
  }
  for (let d = 1; d < columnX.length; d++) columnX[d] += columnX[d - 1];

  // Bottom edge of the last node placed in each column, so a parent never overlaps its neighbours.
  const bottom: number[] = [];
  let cursor = 0;
  const shift = (v: VisibleNode, dy: number) => {
    v.y += dy;
    for (const c of kids.get(v) ?? []) shift(c, dy);
  };
  const subtreeNodes = (v: VisibleNode): VisibleNode[] => [v, ...(kids.get(v) ?? []).flatMap(subtreeNodes)];
  const place = (v: VisibleNode) => {
    v.x = columnX[v.depth];
    const children = kids.get(v) ?? [];
    if (children.length === 0) {
      v.y = Math.max(cursor, (bottom[v.depth] ?? -Infinity) + ROW_GAP);
    } else {
      for (const c of children) place(c);
      const first = children[0];
      const last = children[children.length - 1];
      v.y = (first.y + last.y + last.height) / 2 - v.height / 2;
      const min = (bottom[v.depth] ?? -Infinity) + ROW_GAP;
      if (v.y < min) {
        const dy = min - v.y;
        shift(v, dy);
        for (const n of subtreeNodes(v)) {
          if (n !== v) bottom[n.depth] = Math.max(bottom[n.depth] ?? -Infinity, n.y + n.height);
          cursor = Math.max(cursor, n.y + n.height + ROW_GAP);
        }
      }
    }
    bottom[v.depth] = v.y + v.height;
    cursor = Math.max(cursor, v.y + v.height + ROW_GAP);
  };
  for (const r of roots) {
    place(r);
    // Start the next tree below everything placed so far.
    cursor = Math.max(cursor, ...bottom.filter(Number.isFinite)) + TREE_GAP;
    bottom.length = 0;
  }
  return { nodes: out, byId: new Map(out.map((v) => [v.node.id, v])) };
}
