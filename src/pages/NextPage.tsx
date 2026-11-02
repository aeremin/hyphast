import { useState } from 'react';
import { Link } from 'react-router';
import { type GraphNode } from '../lib/model';
import { setStatus } from '../lib/nodes';
import { initials, memberName, useWorkspace } from '../context/WorkspaceContext';

/** Phone-friendly list of what can be done right now, grouped by project. */
export default function NextPage() {
  const { graph, members, me } = useWorkspace();
  const [who, setWho] = useState<string>(me);
  const [showBlocked, setShowBlocked] = useState(false);

  const matches = (n: GraphNode) => who === 'all' || n.assignee === who || (who === me && !n.assignee);
  const actionable = graph.nodes.filter((n) => graph.isActionable(n) && matches(n));
  const blocked = graph.nodes.filter((n) => n.kind === 'task' && graph.isBlocked(n) && matches(n));
  const sortKey = (n: GraphNode) => `${n.status === 'in_progress' ? 0 : 1}${n.due ?? '9999'}`;

  function groups(list: GraphNode[]) {
    const byProject = new Map<string, GraphNode[]>();
    for (const n of [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
      const project = graph.ancestors(n).find((a) => a.kind === 'project');
      const key = project?.id ?? '';
      byProject.set(key, [...(byProject.get(key) ?? []), n]);
    }
    return [...byProject.entries()];
  }

  const today = new Date().toISOString().slice(0, 10);

  function renderList(list: GraphNode[]) {
    return groups(list).map(([projectId, tasks]) => {
      const project = graph.get(projectId);
      return (
        <section key={projectId} className="card p-0">
          <h2 className="border-b border-slate-100 px-4 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {project ? graph.path(project) : 'No project'}
          </h2>
          <ul>
            {tasks.map((n) => {
              const name = memberName(members, n.assignee);
              const blockers = graph.openBlockers(n);
              return (
                <li key={n.id} className="flex items-start gap-3 border-b border-slate-100 px-4 py-2 last:border-0">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 cursor-pointer accent-emerald-600"
                    checked={false}
                    onChange={() => setStatus(me, n.id, 'done')}
                    title="Mark as done"
                  />
                  <div className="min-w-0 flex-1">
                    <Link to={`/?node=${n.id}`} className="text-sm hover:text-violet-700 hover:underline">
                      {n.title}
                    </Link>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                      {graph.parent(n)?.kind === 'task' && <span>in {graph.parent(n)?.title}</span>}
                      {n.status === 'in_progress' && <span className="text-sky-600">in progress</span>}
                      {n.due && <span className={n.due < today ? 'font-semibold text-red-600' : ''}>due {n.due}</span>}
                      {blockers.length > 0 && (
                        <span className="text-amber-600">waiting for {blockers.map((b) => b.title).join(', ')}</span>
                      )}
                    </div>
                  </div>
                  {name && (
                    <span
                      title={name}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700"
                    >
                      {initials(name)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      );
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Next up</h1>
          <select className="input ml-auto !w-auto" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value={me}>Mine &amp; unassigned</option>
            {members
              .filter((m) => m.email !== me)
              .map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name}
                </option>
              ))}
            <option value="all">Everyone</option>
          </select>
        </div>
        {actionable.length === 0 && <p className="text-sm text-slate-500">Nothing actionable right now. 🎉</p>}
        {renderList(actionable)}
        {blocked.length > 0 && (
          <button className="text-sm text-slate-600 hover:text-slate-900" onClick={() => setShowBlocked((s) => !s)}>
            {showBlocked ? '▾' : '▸'} Blocked ({blocked.length})
          </button>
        )}
        {showBlocked && renderList(blocked)}
      </div>
    </div>
  );
}
