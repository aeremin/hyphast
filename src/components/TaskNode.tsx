import { createContext, memo, useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { isOpen, type GraphNode } from '../lib/model';

export interface TaskNodeData extends Record<string, unknown> {
  node: GraphNode;
  hasChildren: boolean;
  hiddenCount: number;
  collapsed: boolean;
  blocked: boolean;
  actionable: boolean;
  counts: { open: number; total: number } | null;
  assigneeInitials: string;
  assigneeName: string;
  dimmed: boolean;
  highlighted: boolean;
  adding: boolean;
}

export type TaskFlowNode = Node<TaskNodeData, 'task'>;

export interface GraphActions {
  toggleCollapse(id: string): void;
  toggleDone(id: string): void;
  startAdd(id: string): void;
  stopAdd(): void;
  addChildren(parentId: string, titles: string[]): void;
}

export const GraphActionsContext = createContext<GraphActions | null>(null);

const today = () => new Date().toISOString().slice(0, 10);

function TaskNodeView({ data, selected }: NodeProps<TaskFlowNode>) {
  const actions = useContext(GraphActionsContext)!;
  const { node } = data;
  const closed = !isOpen(node.status);
  const overdue = !!node.due && !closed && node.due < today();

  const shell =
    node.kind === 'area'
      ? 'bg-violet-600 text-white border-violet-700 rounded-2xl px-4 py-3'
      : node.kind === 'project'
        ? 'bg-white border-2 border-violet-300 rounded-xl px-3 py-2'
        : `bg-white border rounded-lg px-3 py-2 ${
            data.blocked
              ? 'border-amber-400 bg-amber-50'
              : node.status === 'in_progress'
                ? 'border-sky-400 border-l-4'
                : 'border-slate-300'
          }`;

  return (
    <div
      className={`group relative h-full w-full shadow-sm transition-opacity ${shell} ${
        selected ? 'ring-4 ring-violet-400/60' : data.highlighted ? 'ring-4 ring-yellow-300' : ''
      } ${data.dimmed ? 'opacity-30' : closed ? 'opacity-60' : ''}`}
    >
      <Handle type="target" id="h-in" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <Handle type="source" id="h-out" position={Position.Right} isConnectable={false} className="!opacity-0" />
      <Handle type="target" id="d-in" position={Position.Top} isConnectable={false} className="!opacity-0" />
      <Handle
        type="source"
        id="d-out"
        position={Position.Bottom}
        title="Drag to another node to link"
        className="!h-3 !w-3 !border-2 !border-white !bg-amber-500 opacity-0 transition group-hover:opacity-100"
        style={{ opacity: selected ? 1 : undefined }}
      />

      {node.kind === 'project' && (
        <div className="text-[10px] font-semibold tracking-wider text-violet-500 uppercase">Project</div>
      )}
      <div className="flex items-start gap-2">
        {node.kind === 'task' && (
          <button
            className={`nodrag mt-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border text-[10px] ${
              node.status === 'done'
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : node.status === 'dropped'
                  ? 'border-slate-400 bg-slate-200 text-slate-500'
                  : 'border-slate-400 bg-white hover:border-emerald-500'
            }`}
            title={node.status === 'done' ? 'Mark as to do' : 'Mark as done'}
            onClick={(e) => {
              e.stopPropagation();
              actions.toggleDone(node.id);
            }}
          >
            {node.status === 'done' ? '✓' : node.status === 'dropped' ? '–' : ''}
          </button>
        )}
        <div
          className={`line-clamp-4 min-w-0 flex-1 leading-snug break-words ${
            node.kind === 'area' ? 'text-base font-bold' : node.kind === 'project' ? 'text-sm font-semibold' : 'text-sm'
          } ${closed ? 'line-through' : ''}`}
        >
          {node.title}
        </div>
      </div>

      <div className={`mt-1 flex items-center gap-2 text-[11px] ${node.kind === 'area' ? 'text-violet-100' : 'text-slate-500'}`}>
        {data.counts && data.counts.total > 0 && (
          <span title={`${data.counts.open} of ${data.counts.total} tasks open`} className="flex items-center gap-1">
            <span className={`h-1.5 w-12 overflow-hidden rounded-full ${node.kind === 'area' ? 'bg-violet-400' : 'bg-slate-200'}`}>
              <span
                className={`block h-full ${node.kind === 'area' ? 'bg-white' : 'bg-emerald-500'}`}
                style={{ width: `${(100 * (data.counts.total - data.counts.open)) / data.counts.total}%` }}
              />
            </span>
            {data.counts.open} open
          </span>
        )}
        {node.status === 'in_progress' && <span className="text-sky-600">● in progress</span>}
        {data.blocked && <span className="text-amber-600">⛔ blocked</span>}
        {data.actionable && node.status === 'todo' && <span className="text-emerald-600">● ready</span>}
        {node.due && <span className={overdue ? 'font-semibold text-red-600' : ''}>📅 {node.due.slice(5)}</span>}
        {node.notes && <span title="Has notes">📝</span>}
        {data.assigneeInitials && (
          <span
            title={data.assigneeName}
            className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[9px] font-bold text-violet-700"
          >
            {data.assigneeInitials}
          </span>
        )}
      </div>

      {(data.hasChildren || data.hiddenCount > 0) && (
        <button
          className="nodrag absolute top-1/2 -right-3 z-10 flex h-6 min-w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white px-1 text-[11px] font-semibold text-slate-600 shadow hover:bg-slate-100"
          title={data.collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => {
            e.stopPropagation();
            actions.toggleCollapse(node.id);
          }}
        >
          {data.collapsed ? `+${data.hiddenCount}` : '−'}
        </button>
      )}
      {!data.adding && !closed && (
        <button
          className={`nodrag absolute -bottom-3 left-3 z-10 flex h-6 cursor-pointer items-center rounded-full bg-violet-600 px-2 text-[11px] font-medium text-white shadow transition hover:bg-violet-700 ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          title="Add a child (Tab)"
          onClick={(e) => {
            e.stopPropagation();
            actions.startAdd(node.id);
          }}
        >
          + {node.kind === 'area' ? 'project' : node.kind === 'project' ? 'task' : 'subtask'}
        </button>
      )}
      {data.adding && <QuickAdd parent={node} />}
    </div>
  );
}

/** Inline input for adding children one after another; pasting several lines adds one child per line. */
export function QuickAdd({ parent, className = '' }: { parent: GraphNode | null; className?: string }) {
  const actions = useContext(GraphActionsContext)!;
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // preventScroll: otherwise the browser scrolls React Flow's clipped container to reveal the input.
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const what = !parent ? 'area' : parent.kind === 'area' ? 'project' : parent.kind === 'project' ? 'task' : 'subtask';

  function submit(lines: string[]) {
    const titles = lines.map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    if (titles.length) actions.addChildren(parent?.id ?? '', titles);
    setValue('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (value.trim()) submit([value]);
      else actions.stopAdd();
    } else if (e.key === 'Escape') {
      actions.stopAdd();
    }
  }

  return (
    <div
      className={`nodrag nopan nowheel absolute top-full left-0 z-20 mt-2 w-72 rounded-lg border border-violet-300 bg-white p-2 text-slate-900 shadow-lg ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={input}
        className="input"
        placeholder={`New ${what}…`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => !value.trim() && actions.stopAdd()}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (!text.includes('\n')) return;
          e.preventDefault();
          submit(text.split(/\r?\n/));
        }}
      />
      <p className="mt-1 text-[11px] text-slate-500">Enter adds and keeps going · Esc closes · paste a list to add many</p>
    </div>
  );
}

export default memo(TaskNodeView);
