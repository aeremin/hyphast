import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type FinalConnectionState,
} from '@xyflow/react';
import { isOpen, type GraphNode } from '../lib/model';
import { computeVisible } from '../lib/layout';
import { addBlocker, addRelated, createNode, deleteSubtree, setStatus } from '../lib/nodes';
import { initials, memberName, useWorkspace } from '../context/WorkspaceContext';
import TaskNode, { GraphActionsContext, QuickAdd, type GraphActions, type TaskFlowNode } from '../components/TaskNode';
import NodePanel from '../components/NodePanel';

const nodeTypes = { task: TaskNode };

type LinkMode = 'blocks' | 'related';

interface ViewState {
  showClosed: boolean;
  collapsed: string[];
  focusId: string | null;
  linkMode: LinkMode;
}

const VIEW_KEY = 'hyphast.view';
const DEFAULT_VIEW: ViewState = { showClosed: false, collapsed: [], focusId: null, linkMode: 'blocks' };

function loadView(): ViewState {
  try {
    return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') };
  } catch {
    return DEFAULT_VIEW;
  }
}

/** Collapsing, focus and filters are per device, so each of you can look at the graph your own way. */
function useView() {
  const [view, setView] = useState(loadView);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
      // Storage unavailable (private mode); the view just won't be remembered.
    }
  }, [view]);
  return [view, setView] as const;
}

const ROOT = '';

export default function GraphPage() {
  return (
    <ReactFlowProvider>
      <GraphView />
    </ReactFlowProvider>
  );
}

function GraphView() {
  const { graph, members, me } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('node');
  const [view, setView] = useView();
  const [adding, setAdding] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [toast, setToast] = useState<string | null>(null);
  const [centerTarget, setCenterTarget] = useState<string | null>(selectedId);
  const [showHelp, setShowHelp] = useState(false);
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  const collapsed = useMemo(() => new Set(view.collapsed), [view.collapsed]);
  const focusId = graph.get(view.focusId) ? view.focusId : null;
  const visible = useMemo(
    () => computeVisible(graph, { showClosed: view.showClosed, collapsed, focusId }),
    [graph, view.showClosed, collapsed, focusId],
  );
  const selected = graph.get(selectedId);

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 3500);
  }, []);

  /** Expands, unfocuses or shows closed nodes as needed so `id` is on screen, then selects it. */
  const select = useCallback(
    (id: string | null) => {
      setParams(id ? { node: id } : {}, { replace: true });
      const n = graph.get(id);
      if (!n) return;
      const ancestors = graph.ancestors(n);
      setView((v) => ({
        ...v,
        collapsed: v.collapsed.filter((c) => !ancestors.some((a) => a.id === c)),
        focusId: v.focusId && v.focusId !== n.id && !ancestors.some((a) => a.id === v.focusId) ? null : v.focusId,
        showClosed: v.showClosed || ![n, ...ancestors].every((a) => isOpen(a.status)),
      }));
      setCenterTarget(n.id);
    },
    [graph, setParams, setView],
  );

  const toggleCollapse = useCallback(
    (id: string) =>
      setView((v) => ({
        ...v,
        collapsed: v.collapsed.includes(id) ? v.collapsed.filter((c) => c !== id) : [...v.collapsed, id],
      })),
    [setView],
  );

  const setFocus = useCallback(
    (id: string | null) => {
      setView((v) => ({ ...v, focusId: id, collapsed: id ? v.collapsed.filter((c) => c !== id) : v.collapsed }));
      setTimeout(() => rf.fitView({ duration: 300, maxZoom: 1.2 }), 50);
    },
    [rf, setView],
  );

  const actions: GraphActions = useMemo(
    () => ({
      toggleCollapse,
      toggleDone: (id) => {
        const n = graph.get(id);
        if (n) setStatus(me, id, isOpen(n.status) ? 'done' : 'todo');
      },
      startAdd: (id) => {
        setAdding(id);
        if (id !== ROOT) setView((v) => ({ ...v, collapsed: v.collapsed.filter((c) => c !== id) }));
      },
      stopAdd: () => setAdding(null),
      addChildren: (parentId, titles) => {
        const parent = graph.get(parentId);
        titles.forEach((t, i) => createNode(me, parent, t, i));
        if (!parent) setCenterTarget(null);
      },
    }),
    [graph, me, setView, toggleCollapse],
  );

  // Keep a node centred after it was selected from the panel, search, keyboard or a link.
  useEffect(() => {
    if (!centerTarget) return;
    const v = visible.byId.get(centerTarget);
    const box = wrapper.current?.getBoundingClientRect();
    if (!v || !box) return;
    const { x, y, zoom } = rf.getViewport();
    const left = v.x * zoom + x;
    const top = v.y * zoom + y;
    const inView = left > 0 && top > 0 && left + v.width * zoom < box.width && top + v.height * zoom < box.height;
    if (!inView) rf.setCenter(v.x + v.width / 2, v.y + v.height / 2, { zoom: Math.max(zoom, 0.7), duration: 250 });
    setCenterTarget(null);
  }, [centerTarget, visible, rf]);

  const query = search.trim().toLowerCase();
  const nodes: TaskFlowNode[] = useMemo(
    () =>
      visible.nodes.map((v) => {
        const n = v.node;
        const name = memberName(members, n.assignee);
        const highlighted = !!query && n.title.toLowerCase().includes(query);
        const filteredOut =
          n.kind === 'task' && assignee !== 'all' && n.assignee !== (assignee === 'none' ? null : assignee);
        return {
          id: n.id,
          type: 'task',
          position: { x: v.x, y: v.y },
          // Sizes come from the layout; giving them up front stops React Flow from hiding the node
          // to re-measure it on every update (which also made the quick-add input unfocusable).
          width: v.width,
          height: v.height,
          measured: { width: v.width, height: v.height },
          draggable: false,
          selected: n.id === selectedId,
          // The quick-add box hangs below its node; lift that node above the ones under it.
          zIndex: adding === n.id ? 1000 : undefined,
          data: {
            node: n,
            hasChildren: graph.children(n.id).length > 0 && (view.showClosed || graph.children(n.id).some((c) => isOpen(c.status))),
            hiddenCount: v.hiddenCount,
            collapsed: collapsed.has(n.id),
            blocked: graph.isBlocked(n),
            actionable: graph.isActionable(n),
            counts: n.kind === 'task' ? null : graph.taskCounts(n.id),
            assigneeInitials: name ? initials(name) : '',
            assigneeName: name,
            dimmed: (!!query && !highlighted) || filteredOut,
            highlighted,
            adding: adding === n.id,
          },
        };
      }),
    [visible, graph, members, collapsed, selectedId, query, assignee, adding, view.showClosed],
  );

  const edges: Edge[] = useMemo(() => {
    const out = new Map<string, Edge>();
    // Links into collapsed subtrees attach to the nearest visible ancestor; links to nodes hidden
    // because they're closed aren't drawn.
    const shownAs = (id: string): string | null => {
      for (let n = graph.get(id); n; n = graph.parent(n)) {
        if (!view.showClosed && !isOpen(n.status)) return null;
        if (visible.byId.has(n.id)) return n.id;
      }
      return null;
    };
    for (const v of visible.nodes) {
      const n = v.node;
      if (n.parentId && visible.byId.has(n.parentId) && n.id !== focusId) {
        out.set(`h-${n.id}`, {
          id: `h-${n.id}`,
          source: n.parentId,
          target: n.id,
          sourceHandle: 'h-out',
          targetHandle: 'h-in',
          style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
          selectable: false,
        });
      }
    }
    for (const n of graph.nodes) {
      const to = shownAs(n.id);
      if (!to) continue;
      for (const b of n.blockedBy) {
        const from = shownAs(b);
        const blocker = graph.get(b);
        if (!from || from === to || !blocker) continue;
        const open = graph.isEffectivelyOpen(blocker) && isOpen(n.status);
        const color = open ? '#f59e0b' : '#cbd5e1';
        out.set(`d-${from}-${to}`, {
          id: `d-${from}-${to}`,
          source: from,
          target: to,
          sourceHandle: 'd-out',
          targetHandle: 'd-in',
          animated: open,
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: { stroke: color, strokeWidth: 2, strokeDasharray: '6 4', opacity: from === b && to === n.id ? 1 : 0.5 },
          selectable: false,
        });
      }
      for (const r of n.related) {
        const other = shownAs(r);
        if (!other || other === to || out.has(`r-${other}-${to}`)) continue;
        out.set(`r-${to}-${other}`, {
          id: `r-${to}-${other}`,
          source: to,
          target: other,
          sourceHandle: 'd-out',
          targetHandle: 'd-in',
          style: { stroke: '#94a3b8', strokeWidth: 1.5, strokeDasharray: '2 4' },
          selectable: false,
        });
      }
    }
    return [...out.values()];
  }, [graph, visible, focusId, view.showClosed]);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const from = state.fromNode?.id;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const el = document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node');
      const to = el?.getAttribute('data-id');
      if (!from || !to || from === to) return;
      if (view.linkMode === 'related') {
        addRelated(me, graph, from, to);
        return;
      }
      const err = addBlocker(me, graph, to, from);
      if (err) flash(err);
      else flash(`"${graph.get(to)?.title}" now waits for "${graph.get(from)?.title}"`);
    },
    [graph, me, view.linkMode, flash],
  );

  // Keyboard: arrows move around the tree, Tab adds a child, Enter a sibling, Space toggles done.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') return setShowHelp((s) => !s);
      if (e.key === 'Escape') {
        if (adding !== null) setAdding(null);
        else if (showHelp) setShowHelp(false);
        else select(null);
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('graph-search')?.focus();
        return;
      }
      const n = selected && visible.byId.has(selected.id) ? selected : null;
      if (!n) {
        if (e.key === 'Tab' || e.key === 'n') {
          e.preventDefault();
          setAdding(ROOT);
        } else if (e.key.startsWith('Arrow') && visible.nodes.length) {
          e.preventDefault();
          select(visible.nodes[0].node.id);
        }
        return;
      }
      const siblings = (n.id === focusId ? [n] : graph.children(n.parentId)).filter((s) => visible.byId.has(s.id));
      const idx = siblings.findIndex((s) => s.id === n.id);
      const order = visible.nodes.findIndex((v) => v.node.id === n.id);
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          if (isOpen(n.status)) actions.startAdd(n.id);
          break;
        case 'Enter':
          e.preventDefault();
          setAdding(n.id === focusId ? n.id : (n.parentId ?? ROOT));
          break;
        case ' ':
          e.preventDefault();
          actions.toggleDone(n.id);
          break;
        case 'c':
          toggleCollapse(n.id);
          break;
        case 'f':
          setFocus(focusId === n.id ? null : n.id);
          break;
        case 'e':
        case 'F2':
          e.preventDefault();
          document.getElementById('node-title')?.focus();
          break;
        case 'Delete': {
          const count = graph.descendants(n.id).length;
          if (confirm(`Delete "${n.title}"${count ? ` and ${count} nodes below it` : ''}?`)) {
            deleteSubtree(me, graph, n.id);
            select(n.parentId);
          }
          break;
        }
        case 'ArrowLeft':
          e.preventDefault();
          if (n.parentId && visible.byId.has(n.parentId) && n.id !== focusId) select(n.parentId);
          break;
        case 'ArrowRight': {
          e.preventDefault();
          if (collapsed.has(n.id)) toggleCollapse(n.id);
          else {
            const child = graph.children(n.id).find((c) => visible.byId.has(c.id));
            if (child) select(child.id);
          }
          break;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const step = e.key === 'ArrowUp' ? -1 : 1;
          const next = siblings[idx + step] ?? visible.nodes[order + step]?.node;
          if (next) select(next.id);
          break;
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, adding, collapsed, focusId, graph, me, select, selected, setFocus, showHelp, toggleCollapse, visible]);

  const focus = graph.get(focusId);
  const empty = graph.nodes.length === 0;

  return (
    <GraphActionsContext.Provider value={actions}>
      <div className="flex h-full flex-col md:flex-row">
        <div ref={wrapper} className="relative min-h-0 flex-1">
          <Toolbar
            focus={focus}
            onClearFocus={() => setFocus(null)}
            search={search}
            onSearch={setSearch}
            onSearchEnter={() => {
              const hit = graph.nodes.find((n) => n.title.toLowerCase().includes(query));
              if (hit) select(hit.id);
            }}
            assignee={assignee}
            onAssignee={setAssignee}
            view={view}
            setView={setView}
            onAddArea={() => setAdding(ROOT)}
            onCollapseProjects={() =>
              setView((v) => ({ ...v, collapsed: graph.nodes.filter((n) => n.kind === 'project').map((n) => n.id) }))
            }
            onExpandAll={() => setView((v) => ({ ...v, collapsed: [] }))}
            onHelp={() => setShowHelp((s) => !s)}
          />
          {adding === ROOT && (
            <div className="absolute top-14 left-3 z-20 w-72">
              <QuickAdd parent={null} className="!static !mt-0" />
            </div>
          )}
          {toast && (
            <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white shadow-lg">
              {toast}
            </div>
          )}
          {showHelp && <Help onClose={() => setShowHelp(false)} />}
          {empty && adding === null && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="card pointer-events-auto max-w-sm space-y-3 text-center">
                <h2 className="text-lg font-semibold">Start with an area</h2>
                <p className="text-sm text-slate-600">
                  Areas are broad fields of work like “Embedded” or “Home”. Add projects to them, then tasks.
                </p>
                <button className="btn btn-primary" onClick={() => setAdding(ROOT)}>
                  + Add an area
                </button>
              </div>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => select(n.id)}
            onPaneClick={() => {
              select(null);
              setAdding(null);
            }}
            onConnectEnd={onConnectEnd}
            nodesDraggable={false}
            nodesConnectable
            elementsSelectable
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            disableKeyboardA11y
            fitView
            fitViewOptions={{ maxZoom: 1.1 }}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} color="#e2e8f0" />
            <Controls showInteractive={false} position="bottom-right" />
            <MiniMap pannable zoomable className="!hidden md:!block" position="bottom-left" nodeColor={miniMapColor} />
          </ReactFlow>
        </div>
        {selected && (
          <div className="h-[55vh] shrink-0 border-t border-slate-200 md:h-full md:w-96 md:border-t-0 md:border-l">
            <NodePanel node={selected} onClose={() => select(null)} onSelect={select} onFocus={(id) => setFocus(id)} />
          </div>
        )}
      </div>
    </GraphActionsContext.Provider>
  );
}

function miniMapColor(n: { data: Record<string, unknown> }) {
  const node = n.data.node as GraphNode;
  if (node.kind === 'area') return '#7c3aed';
  if (node.kind === 'project') return '#c4b5fd';
  return isOpen(node.status) ? '#94a3b8' : '#e2e8f0';
}

function Toolbar(props: {
  focus: GraphNode | null;
  onClearFocus: () => void;
  search: string;
  onSearch: (s: string) => void;
  onSearchEnter: () => void;
  assignee: string;
  onAssignee: (a: string) => void;
  view: ViewState;
  setView: (f: (v: ViewState) => ViewState) => void;
  onAddArea: () => void;
  onCollapseProjects: () => void;
  onExpandAll: () => void;
  onHelp: () => void;
}) {
  const { members, me } = useWorkspace();
  const { view, setView } = props;
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2 text-sm backdrop-blur">
      <button className="btn btn-primary btn-sm" onClick={props.onAddArea} title="Add an area (N)">
        + Area
      </button>
      {props.focus && (
        <span className="chip border-violet-300 bg-violet-50 text-violet-800">
          Focus: <b className="max-w-40 truncate">{props.focus.title}</b>
          <button className="text-violet-500 hover:text-violet-900" onClick={props.onClearFocus} title="Show everything">
            ×
          </button>
        </span>
      )}
      <input
        id="graph-search"
        className="input !w-40 !py-1"
        placeholder="Search… (/)"
        value={props.search}
        onChange={(e) => props.onSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onSearchEnter();
          if (e.key === 'Escape') {
            props.onSearch('');
            e.currentTarget.blur();
          }
        }}
      />
      <select className="input !w-auto !py-1" value={props.assignee} onChange={(e) => props.onAssignee(e.target.value)}>
        <option value="all">Everyone</option>
        <option value={me}>Mine</option>
        {members
          .filter((m) => m.email !== me)
          .map((m) => (
            <option key={m.email} value={m.email}>
              {m.name}
            </option>
          ))}
        <option value="none">Unassigned</option>
      </select>
      <label className="flex cursor-pointer items-center gap-1 text-slate-600">
        <input
          type="checkbox"
          checked={view.showClosed}
          onChange={(e) => setView((v) => ({ ...v, showClosed: e.target.checked }))}
        />
        Show done
      </label>
      <div className="hidden items-center gap-1 text-slate-600 sm:flex" title="What dragging from a node's orange dot to another node creates">
        <span className="hidden lg:inline">Drag link:</span>
        {(['blocks', 'related'] as const).map((m) => (
          <button
            key={m}
            className={`btn btn-sm ${view.linkMode === m ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setView((v) => ({ ...v, linkMode: m }))}
          >
            {m === 'blocks' ? 'Blocks →' : 'Related'}
          </button>
        ))}
      </div>
      <div className="ml-auto flex gap-1">
        <button className="btn btn-secondary btn-sm" onClick={props.onCollapseProjects} title="Collapse every project">
          Collapse
        </button>
        <button className="btn btn-secondary btn-sm" onClick={props.onExpandAll}>
          Expand
        </button>
        <button className="btn btn-secondary btn-sm hidden sm:inline-flex" onClick={props.onHelp} title="Keyboard shortcuts (?)">
          ?
        </button>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Tab', 'Add a child to the selected node'],
  ['Enter', 'Add a sibling'],
  ['N', 'Add an area (nothing selected)'],
  ['Space', 'Toggle done'],
  ['← → ↑ ↓', 'Move around the tree (→ expands)'],
  ['C', 'Collapse / expand'],
  ['F', 'Focus on the subtree / back to everything'],
  ['E', 'Edit the title'],
  ['Delete', 'Delete'],
  ['/', 'Search'],
  ['Esc', 'Close / deselect'],
];

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute top-14 right-3 z-20 w-80 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-lg">
      <div className="mb-2 flex items-center">
        <h3 className="font-semibold">Keyboard &amp; mouse</h3>
        <button className="ml-auto text-slate-400 hover:text-slate-700" onClick={onClose}>
          ×
        </button>
      </div>
      <table className="w-full">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td className="py-0.5 pr-3 whitespace-nowrap">
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 text-xs">{k}</kbd>
              </td>
              <td className="text-slate-600">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500">
        Drag from a node's orange dot onto another node to link them: “Blocks →” makes the target wait for the source.
        Dashed orange arrows are open dependencies; dotted lines are related links.
      </p>
    </div>
  );
}
