import { useState } from 'react';
import { isOpen, type GraphNode } from '../lib/model';
import { createNode } from '../lib/nodes';
import { useWorkspace } from '../context/WorkspaceContext';

const NEW_AREA = '';

/** Areas as collapsible sections listing their projects; picking a project shows it in the graph. */
export default function Sidebar({
  projectId,
  showClosed,
  collapsedAreas,
  onToggleArea,
  onSelectProject,
  onEdit,
}: {
  projectId: string | null;
  showClosed: boolean;
  collapsedAreas: Set<string>;
  onToggleArea: (id: string, open?: boolean) => void;
  onSelectProject: (id: string) => void;
  /** Opens a node (an area or project) in the side panel. */
  onEdit: (id: string) => void;
}) {
  const { graph, me } = useWorkspace();
  // Area whose "new project" input is open, or NEW_AREA for the "new area" input.
  const [adding, setAdding] = useState<string | null>(null);
  const shown = (n: GraphNode) => showClosed || isOpen(n.status);
  const areas = graph.roots().filter((a) => a.kind === 'area' && shown(a));

  function addArea(title: string) {
    const id = createNode(me, null, title);
    onToggleArea(id, true);
    // Straight on to the area's first project.
    setAdding(id);
  }

  function addProject(area: GraphNode, title: string) {
    onSelectProject(createNode(me, area, title));
    setAdding(null);
  }

  return (
    <nav className="flex h-full w-64 flex-col overflow-y-auto border-r border-slate-200 bg-slate-50 px-2 py-3 text-sm">
      <div className="mb-2 flex items-center px-2">
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Projects</span>
        <button
          className="ml-auto rounded px-1.5 text-xs font-medium text-violet-600 hover:bg-violet-100"
          onClick={() => setAdding(NEW_AREA)}
          title="New area"
        >
          + Area
        </button>
      </div>

      {adding === NEW_AREA && (
        <NewItemInput placeholder="New area…" onSubmit={addArea} onCancel={() => setAdding(null)} />
      )}

      {areas.length === 0 && adding !== NEW_AREA && (
        <p className="px-2 py-1 text-slate-500">
          Start with an area, a broad field of work like “Embedded” or “Home”.
        </p>
      )}

      {areas.map((area) => {
        const open = !collapsedAreas.has(area.id);
        const projects = graph.children(area.id).filter((p) => p.kind === 'project' && shown(p));
        return (
          <section key={area.id} className="mb-1">
            <div className="group flex items-center rounded-md hover:bg-slate-200/60">
              <button
                className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-left"
                onClick={() => onToggleArea(area.id)}
                aria-expanded={open}
              >
                <svg
                  viewBox="0 0 16 16"
                  className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
                  aria-hidden
                >
                  <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span className={`truncate font-semibold text-slate-700 ${isOpen(area.status) ? '' : 'line-through'}`}>
                  {area.title}
                </span>
              </button>
              <button
                className="hidden rounded px-1 text-slate-400 group-hover:block hover:bg-slate-300/60 hover:text-slate-700"
                onClick={() => onEdit(area.id)}
                title="Edit area"
              >
                ✎
              </button>
              <button
                className="mr-1 hidden rounded px-1 text-slate-400 group-hover:block hover:bg-slate-300/60 hover:text-slate-700"
                onClick={() => {
                  onToggleArea(area.id, true);
                  setAdding(area.id);
                }}
                title="New project"
              >
                +
              </button>
            </div>
            {open && (
              <ul className="ml-3 border-l border-slate-200 pl-1">
                {projects.map((p) => {
                  const { open: openTasks } = graph.taskCounts(p.id);
                  const active = p.id === projectId;
                  return (
                    <li key={p.id}>
                      <button
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left ${
                          active ? 'bg-violet-100 font-medium text-violet-900' : 'text-slate-700 hover:bg-slate-200/60'
                        }`}
                        onClick={() => onSelectProject(p.id)}
                      >
                        <span className={`min-w-0 flex-1 truncate ${isOpen(p.status) ? '' : 'text-slate-400 line-through'}`}>
                          {p.title}
                        </span>
                        {openTasks > 0 && <span className="text-xs text-slate-400">{openTasks}</span>}
                      </button>
                    </li>
                  );
                })}
                {projects.length === 0 && adding !== area.id && (
                  <li>
                    <button
                      className="px-2 py-1 text-left text-xs text-slate-400 hover:text-violet-700"
                      onClick={() => setAdding(area.id)}
                    >
                      + Add a project
                    </button>
                  </li>
                )}
                {adding === area.id && (
                  <li>
                    <NewItemInput
                      placeholder="New project…"
                      onSubmit={(title) => addProject(area, title)}
                      onCancel={() => setAdding(null)}
                    />
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}

function NewItemInput({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <input
      autoFocus
      className="input my-1 !py-1"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => !value.trim() && onCancel()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter') {
          if (value.trim()) onSubmit(value.trim());
          else onCancel();
        }
      }}
    />
  );
}
