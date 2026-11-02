import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NODE_STATUSES, STATUS_LABELS, parentError, type GraphNode } from '../lib/model';
import {
  addBlocker,
  addRelated,
  deleteSubtree,
  removeBlocker,
  removeRelated,
  setStatus,
  updateNode,
} from '../lib/nodes';
import { useWorkspace } from '../context/WorkspaceContext';
import NodePicker from './NodePicker';

type Picking = 'blocker' | 'blocks' | 'related' | 'parent' | null;

export default function NodePanel({
  node,
  onClose,
  onSelect,
}: {
  node: GraphNode;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const { graph, members, me } = useWorkspace();
  const [title, setTitle] = useState(node.title);
  const [notes, setNotes] = useState(node.notes);
  const [picking, setPicking] = useState<Picking>(null);
  const [error, setError] = useState<string | null>(null);

  // Follow remote edits unless the field is being edited here.
  useEffect(() => setTitle(node.title), [node.id, node.title]);
  useEffect(() => setNotes(node.notes), [node.id, node.notes]);
  useEffect(() => {
    setPicking(null);
    setError(null);
  }, [node.id]);

  const saveTitle = () => {
    const t = title.trim();
    if (!t) setTitle(node.title);
    else if (t !== node.title) updateNode(me, node.id, { title: t });
  };
  const saveNotes = () => notes !== node.notes && updateNode(me, node.id, { notes });

  const allowParent = useCallback(
    (n: GraphNode) => n.id !== node.parentId && !graph.moveError(node.id, n.id) && !parentError(node.kind, n),
    [graph, node],
  );
  const notSelf = useCallback((n: GraphNode) => n.id !== node.id, [node.id]);

  function pick(n: GraphNode) {
    let err: string | null = null;
    if (picking === 'blocker') err = addBlocker(me, graph, node.id, n.id);
    if (picking === 'blocks') err = addBlocker(me, graph, n.id, node.id);
    if (picking === 'related') addRelated(me, graph, node.id, n.id);
    if (picking === 'parent') updateNode(me, node.id, { parentId: n.id });
    setError(err);
    setPicking(null);
  }

  const parent = graph.parent(node);
  const descendants = graph.descendants(node.id).length;
  const counts = node.kind !== 'task' ? graph.taskCounts(node.id) : null;

  return (
    <aside className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
        <span className="text-xs font-semibold tracking-wider text-violet-600 uppercase">{node.kind}</span>
        <div className="min-w-0 flex-1 truncate text-xs text-slate-500">
          {graph.ancestors(node).map((a) => (
            <button key={a.id} className="hover:text-violet-700 hover:underline" onClick={() => onSelect(a.id)}>
              {a.title} ›{' '}
            </button>
          ))}
        </div>
        <button className="text-xl leading-none text-slate-400 hover:text-slate-700" onClick={onClose} title="Close (Esc)">
          ×
        </button>
      </div>

      <div className="space-y-4 p-4">
        <textarea
          id="node-title"
          className="w-full resize-none rounded-lg border border-transparent px-1 py-0.5 text-lg font-semibold hover:border-slate-200 focus:border-violet-400 focus:outline-none"
          rows={Math.min(4, Math.max(1, Math.ceil(title.length / 32)))}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setTitle(node.title);
              e.currentTarget.blur();
            }
          }}
        />

        <div>
          <span className="label">Status</span>
          <div className="flex flex-wrap gap-1">
            {NODE_STATUSES.map((s) => (
              <button
                key={s}
                className={`btn btn-sm ${node.status === s ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStatus(me, node.id, s)}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {counts && counts.total > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {counts.total - counts.open} of {counts.total} tasks finished
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">Assignee</span>
            <select
              className="input"
              value={node.assignee ?? ''}
              onChange={(e) => updateNode(me, node.id, { assignee: e.target.value || null })}
            >
              <option value="">Nobody</option>
              {members.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Due</span>
            <input
              type="date"
              className="input"
              value={node.due ?? ''}
              onChange={(e) => updateNode(me, node.id, { due: e.target.value || null })}
            />
          </label>
        </div>

        <label className="block">
          <span className="label">Notes</span>
          <textarea
            className="input min-h-28 font-mono text-xs"
            placeholder="Details, links, checklists (Markdown)…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <LinkList
          title="Blocked by"
          hint="Must be finished first"
          nodes={graph.blockers(node)}
          onSelect={onSelect}
          onRemove={(id) => removeBlocker(me, node.id, id)}
          onAdd={() => setPicking('blocker')}
        />
        <LinkList
          title="Blocks"
          hint="Waiting for this one"
          nodes={graph.blocks(node.id)}
          onSelect={onSelect}
          onRemove={(id) => removeBlocker(me, id, node.id)}
          onAdd={() => setPicking('blocks')}
        />
        <LinkList
          title="Related"
          nodes={graph.relatedNodes(node.id)}
          onSelect={onSelect}
          onRemove={(id) => removeRelated(me, graph, node.id, id)}
          onAdd={() => setPicking('related')}
        />

        {picking && (
          <NodePicker
            graph={graph}
            allow={picking === 'parent' ? allowParent : notSelf}
            onPick={pick}
            onCancel={() => setPicking(null)}
            placeholder={
              picking === 'parent'
                ? 'Move under…'
                : picking === 'related'
                  ? 'Related to…'
                  : picking === 'blocker'
                    ? 'Blocked by…'
                    : 'Blocks…'
            }
          />
        )}

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          {node.kind !== 'area' && (
            <button className="btn btn-secondary btn-sm" onClick={() => setPicking('parent')}>
              Move…
            </button>
          )}
          <button
            className="btn btn-sm ml-auto text-red-600 hover:bg-red-50"
            onClick={() => {
              const what = descendants ? ` and everything below it (${descendants} more)` : '';
              if (!confirm(`Delete "${node.title}"${what}? Marking it done or dropped keeps the history.`)) return;
              deleteSubtree(me, graph, node.id);
              onClose();
            }}
          >
            Delete
          </button>
        </div>
        {parent && (
          <p className="text-xs text-slate-400">
            In <button className="hover:underline" onClick={() => onSelect(parent.id)}>{parent.title}</button> ·{' '}
            <code className="select-all">{node.id}</code>
          </p>
        )}
        {!parent && <code className="block text-xs text-slate-400 select-all">{node.id}</code>}
      </div>
    </aside>
  );
}

function LinkList({
  title,
  hint,
  nodes,
  onSelect,
  onRemove,
  onAdd,
}: {
  title: string;
  hint?: ReactNode;
  nodes: GraphNode[];
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="label">{title}</span>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
        <button className="ml-auto text-xs font-medium text-violet-600 hover:text-violet-800" onClick={onAdd}>
          + Add
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {nodes.map((n) => (
          <span key={n.id} className="chip">
            <button
              className={`truncate hover:text-violet-700 ${n.status === 'done' || n.status === 'dropped' ? 'line-through' : ''}`}
              onClick={() => onSelect(n.id)}
            >
              {n.title}
            </button>
            <button className="text-slate-400 hover:text-red-600" onClick={() => onRemove(n.id)} title="Remove link">
              ×
            </button>
          </span>
        ))}
        {nodes.length === 0 && <span className="text-xs text-slate-400">None</span>}
      </div>
    </div>
  );
}
