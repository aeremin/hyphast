import { useMemo, useState } from 'react';
import { isOpen, type Graph, type GraphNode } from '../lib/model';

/** Search box listing nodes that pass `allow`; picking one calls onPick. */
export default function NodePicker({
  graph,
  allow,
  onPick,
  onCancel,
  placeholder,
}: {
  graph: Graph;
  allow: (n: GraphNode) => boolean;
  onPick: (n: GraphNode) => void;
  onCancel: () => void;
  placeholder: string;
}) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return graph.nodes
      .filter((n) => allow(n) && (!query || n.title.toLowerCase().includes(query)))
      .sort((a, b) => Number(isOpen(b.status)) - Number(isOpen(a.status)))
      .slice(0, 30);
  }, [graph, allow, q]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <input
        autoFocus
        className="input"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && matches[0]) onPick(matches[0]);
        }}
      />
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {matches.map((n) => (
          <li key={n.id}>
            <button
              className="w-full cursor-pointer rounded px-2 py-1 text-left hover:bg-violet-50"
              onClick={() => onPick(n)}
            >
              <div className={`text-sm ${isOpen(n.status) ? '' : 'text-slate-400 line-through'}`}>{n.title}</div>
              <div className="truncate text-[11px] text-slate-500">
                {n.kind} · {graph.ancestors(n).map((a) => a.title).join(' › ') || 'top level'}
              </div>
            </button>
          </li>
        ))}
        {matches.length === 0 && <li className="px-2 py-1 text-sm text-slate-500">Nothing found</li>}
      </ul>
      <button className="mt-1 text-xs text-slate-500 hover:text-slate-800" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
