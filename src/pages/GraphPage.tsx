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
import { isOpen, type Graph, type GraphNode } from '../lib/model';
import { computeVisible } from '../lib/layout';
import { addBlocker, addRelated, createNode, deleteSubtree, setStatus } from '../lib/nodes';
import { initials, memberName, useWorkspace } from '../context/WorkspaceContext';
import TaskNode, { GraphActionsContext, type GraphActions, type TaskFlowNode } from '../components/TaskNode';
import NodePanel from '../components/NodePanel';
import Sidebar from '../components/Sidebar';

const nodeTypes = { task: TaskNode };

type LinkMode = 'blocks' | 'related';

interface ViewState {
  showClosed: boolean;
  collapsed: string[];
  collapsedAreas: string[];
  /** Project shown when the URL doesn't name one. */
  lastProjectId: string | null;
  linkMode: LinkMode;
}

const VIEW_KEY = 'hyphast.view';
const DEFAULT_VIEW: ViewState = {
  showClosed: false,
  collapsed: [],
  collapsedAreas: [],
  lastProjectId: null,
  linkMode: 'blocks',
};

function loadView(): ViewState {
  try {
    return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') };
  } catch {
    return DEFAULT_VIEW;
  }
}

/** Collapsing, the last project and filters are per device, so each of you can look at things your own way. */
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

/** The project a node belongs to (itself for a project; null for an area). */
function projectOf(graph: Graph, n: GraphNode | null): GraphNode | null {
  if (!n || n.kind === 'area') return null;
  if (n.kind === 'project') return n;
  return graph.ancestors(n).find((a) => a.kind === 'project') ?? null;
}

function toggled(list: string[], id: string, on?: boolean) {
  const has = list.includes(id);
  const want = on ?? !has;
  if (want === has) return list;
  return want ? [...list, id] : list.filter((x) => x !== id);
}

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  // The project comes from the URL, else the selected node's project (links from the Next page),
  // else the one shown last on this device.
  const project =
    [params.get('project'), projectOf(graph, graph.get(selectedId))?.id, view.lastProjectId]
      .map((id) => graph.get(id))
      .find((n) => n?.kind === 'project') ?? null;
  const projectId = project?.id ?? null;
  useEffect(() => {
    if (projectId && projectId !== view.lastProjectId) setView((v) => ({ ...v, lastProjectId: projectId }));
  }, [projectId, view.lastProjectId, setView]);

  const collapsed = useMemo(() => new Set(view.collapsed), [view.collapsed]);
  const collapsedAreas = useMemo(() => new Set(view.collapsedAreas), [view.collapsedAreas]);
  const visible = useMemo(
    () => computeVisible(graph, { showClosed: view.showClosed, collapsed, rootId: projectId }),
    [graph, view.showClosed, collapsed, projectId],
  );
  const selected = graph.get(selectedId);

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 3500);
  }, []);

  const selectProject = useCallback(
    (id: string) => {
      setParams({ project: id }, { replace: true });
      setAdding(null);
      setSidebarOpen(false);
      setTimeout(() => rf.fitView({ duration: 300, maxZoom: 1.1 }), 50);
    },
    [rf, setParams],
  );

  /**
   * Selects a node, opening it in the side panel. Switches to its project and expands or shows
   * closed nodes as needed so it's on screen.
   */
  const select = useCallback(
    (id: string | null) => {
      const n = graph.get(id);
      const target = projectOf(graph, n)?.id ?? projectId;
      setParams(
        () => {
          const p = new URLSearchParams();
          if (target) p.set('project', target);
          if (id) p.set('node', id);
          return p;
        },
        { replace: true },
      );
      if (!n) return;
      if (target !== projectId) setTimeout(() => rf.fitView({ duration: 300, maxZoom: 1.1 }), 50);
      const ancestors = graph.ancestors(n);
      setView((v) => ({
        ...v,
        collapsed: v.collapsed.filter((c) => !ancestors.some((a) => a.id === c)),
        collapsedAreas: n.kind === 'area' ? v.collapsedAreas : v.collapsedAreas.filter((c) => c !== ancestors[0]?.id),
        showClosed: v.showClosed || ![n, ...ancestors].every((a) => isOpen(a.status)),
      }));
      setCenterTarget(n.id);
    },
    [graph, projectId, rf, setParams, setView],
  );

  const toggleCollapse = useCallback(
    (id: string) => setView((v) => ({ ...v, collapsed: toggled(v.collapsed, id) })),
    [setView],
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
        setView((v) => ({ ...v, collapsed: v.collapsed.filter((c) => c !== id) }));
      },
      stopAdd: () => setAdding(null),
      addChildren: (parentId, titles) => {
        const parent = graph.get(parentId);
        if (parent) titles.forEach((t, i) => createNode(me, parent, t, i));
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
            hasChildren:
              graph.children(n.id).length > 0 &&
              (view.showClosed || graph.children(n.id).some((c) => isOpen(c.status))),
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
    // because they're closed, or in other projects, aren't drawn.
    const shownAs = (id: string): string | null => {
      for (let n = graph.get(id); n; n = graph.parent(n)) {
        if (!view.showClosed && !isOpen(n.status)) return null;
        if (visible.byId.has(n.id)) return n.id;
      }
      return null;
    };
    for (const v of visible.nodes) {
      const n = v.node;
      if (n.parentId && visible.byId.has(n.parentId)) {
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
  }, [graph, visible, view.showClosed]);

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
        if (e.key === 'Tab' && project) {
          e.preventDefault();
          actions.startAdd(project.id);
        } else if (e.key.startsWith('Arrow') && visible.nodes.length) {
          e.preventDefault();
          select(visible.nodes[0].node.id);
        }
        return;
      }
      const isRoot = n.id === projectId;
      const siblings = (isRoot ? [n] : graph.children(n.parentId)).filter((s) => visible.byId.has(s.id));
      const idx = siblings.findIndex((s) => s.id === n.id);
      const order = visible.nodes.findIndex((v) => v.node.id === n.id);
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          if (isOpen(n.status)) actions.startAdd(n.id);
          break;
        case 'Enter':
          e.preventDefault();
          actions.startAdd(isRoot ? n.id : (n.parentId as string));
          break;
        case ' ':
          e.preventDefault();
          actions.toggleDone(n.id);
          break;
        case 'c':
          toggleCollapse(n.id);
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
            select(isRoot ? null : n.parentId);
          }
          break;
        }
        case 'ArrowLeft':
          e.preventDefault();
          if (!isRoot && n.parentId) select(n.parentId);
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
  }, [actions, adding, collapsed, graph, me, project, projectId, select, selected, showHelp, toggleCollapse, visible]);

  const area = project ? graph.parent(project) : null;
  const sidebar = (
    <Sidebar
      projectId={projectId}
      showClosed={view.showClosed}
      collapsedAreas={collapsedAreas}
      onToggleArea={(id, open) =>
        setView((v) => ({ ...v, collapsedAreas: toggled(v.collapsedAreas, id, open === undefined ? undefined : !open) }))
      }
      onSelectProject={selectProject}
      onEdit={(id) => {
        select(id);
        setSidebarOpen(false);
      }}
    />
  );

  return (
    <GraphActionsContext.Provider value={actions}>
      <div className="relative flex h-full">
        <div className="hidden md:block">{sidebar}</div>
        {sidebarOpen && (
          <div className="absolute inset-0 z-30 flex md:hidden">
            {sidebar}
            <div className="flex-1 bg-slate-900/30" onClick={() => setSidebarOpen(false)} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col md:flex-row">
          <div ref={wrapper} className="relative min-h-0 flex-1">
            <Toolbar
              project={project}
              area={area}
              onOpenSidebar={() => setSidebarOpen(true)}
              onSelect={select}
              search={search}
              onSearch={setSearch}
              onSearchEnter={() => {
                const hit = graph.nodes.find((n) => n.kind !== 'area' && n.title.toLowerCase().includes(query));
                if (hit) select(hit.id);
              }}
              assignee={assignee}
              onAssignee={setAssignee}
              view={view}
              setView={setView}
              onCollapseAll={() =>
                setView((v) => ({
                  ...v,
                  collapsed: projectId
                    ? graph.descendants(projectId).filter((n) => graph.children(n.id).length).map((n) => n.id)
                    : [],
                }))
              }
              onExpandAll={() => setView((v) => ({ ...v, collapsed: [] }))}
              onHelp={() => setShowHelp((s) => !s)}
            />
            {toast && (
              <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white shadow-lg">
                {toast}
              </div>
            )}
            {showHelp && <Help onClose={() => setShowHelp(false)} />}
            {!project && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
                <div className="card pointer-events-auto max-w-sm space-y-3 text-center">
                  <h2 className="text-lg font-semibold">Pick a project</h2>
                  <p className="text-sm text-slate-600">
                    Choose a project in the sidebar, or create an area and a project there with <b>+</b>.
                  </p>
                  <button className="btn btn-secondary md:hidden" onClick={() => setSidebarOpen(true)}>
                    Show projects
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
              <MiniMap pannable zoomable className="!hidden lg:!block" position="bottom-left" nodeColor={miniMapColor} />
            </ReactFlow>
          </div>
          {selected && (
            <div className="h-[55vh] shrink-0 border-t border-slate-200 md:h-full md:w-96 md:border-t-0 md:border-l">
              <NodePanel node={selected} onClose={() => select(null)} onSelect={select} />
            </div>
          )}
        </div>
      </div>
    </GraphActionsContext.Provider>
  );
}

function miniMapColor(n: { data: Record<string, unknown> }) {
  const node = n.data.node as GraphNode;
  if (node.kind === 'project') return '#c4b5fd';
  return isOpen(node.status) ? '#94a3b8' : '#e2e8f0';
}

function Toolbar(props: {
  project: GraphNode | null;
  area: GraphNode | null;
  onOpenSidebar: () => void;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (s: string) => void;
  onSearchEnter: () => void;
  assignee: string;
  onAssignee: (a: string) => void;
  view: ViewState;
  setView: (f: (v: ViewState) => ViewState) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onHelp: () => void;
}) {
  const { members, me } = useWorkspace();
  const { view, setView, project, area } = props;
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2 text-sm backdrop-blur">
      <button className="btn btn-secondary btn-sm md:hidden" onClick={props.onOpenSidebar} title="Projects">
        ☰
      </button>
      {project && (
        <div className="flex min-w-0 items-center gap-1">
          {area && (
            <button className="max-w-32 truncate text-slate-500 hover:text-violet-700" onClick={() => props.onSelect(area.id)}>
              {area.title}
            </button>
          )}
          {area && <span className="text-slate-300">›</span>}
          <button
            className="max-w-48 truncate font-semibold text-slate-800 hover:text-violet-700"
            onClick={() => props.onSelect(project.id)}
          >
            {project.title}
          </button>
        </div>
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
      <div
        className="hidden items-center gap-1 text-slate-600 sm:flex"
        title="What dragging from a node's orange dot to another node creates"
      >
        <span className="hidden xl:inline">Drag link:</span>
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
        <button className="btn btn-secondary btn-sm" onClick={props.onCollapseAll} title="Collapse every task with subtasks">
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
  ['Tab', 'Add a child to the selected node (or to the project)'],
  ['Enter', 'Add a sibling'],
  ['Space', 'Toggle done'],
  ['← → ↑ ↓', 'Move around the tree (→ expands)'],
  ['C', 'Collapse / expand'],
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
        Dashed orange arrows are open dependencies; dotted lines are related links. Links to other projects show on the
        node's side panel.
      </p>
    </div>
  );
}
