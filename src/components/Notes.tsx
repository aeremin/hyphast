import { useState, type MouseEvent } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// The list marker and opening bracket of a task list item, e.g. "  - [" or "> 1. [".
const TASK_ITEM = /^([\s>]*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/;

/** Flips the checkbox of the task list item that starts on `line` (1-based). */
function toggleTask(text: string, line: number): string {
  const lines = text.split('\n');
  const l = lines[line - 1];
  if (l === undefined || !TASK_ITEM.test(l)) return text;
  lines[line - 1] = l.replace(TASK_ITEM, (_, start: string, mark: string) => `${start}${mark === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}

/** Markdown notes: rendered when idle, a textarea while editing. Checkboxes can be ticked in place. */
export default function Notes({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (notes: string) => void;
  /** Persists the given notes (the current value when called on blur). */
  onSave: (notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  const components: Components = {
    a: ({ node: _, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
    // GFM renders task checkboxes disabled; enable them and let the change bubble to their list item.
    input: ({ node: _, ...props }) =>
      props.type === 'checkbox' ? <input {...props} disabled={false} onChange={() => {}} /> : <input {...props} />,
    li: ({ node, ...props }) => (
      <li
        {...props}
        onChange={(e) => {
          e.stopPropagation();
          const line = node?.position?.start.line;
          if (!line) return;
          const next = toggleTask(value, line);
          if (next === value) return;
          onChange(next);
          onSave(next);
        }}
      />
    ),
  };

  // Click to edit, except on links and checkboxes or after selecting text to copy it.
  function startEditing(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('a, input')) return;
    if (!window.getSelection()?.isCollapsed) return;
    setEditing(true);
  }

  if (editing || !value.trim()) {
    return (
      <textarea
        className="input min-h-28 font-mono text-xs"
        placeholder="Details, links, checklists (Markdown)…"
        rows={Math.min(30, Math.max(5, value.split('\n').length + 1))}
        autoFocus={editing}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          const end = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(end, end);
          setEditing(true);
        }}
        onBlur={() => {
          setEditing(false);
          onSave(value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
      />
    );
  }

  return (
    <div
      className="prose prose-sm prose-slate max-w-none cursor-text rounded-lg border border-transparent px-3 py-2 break-words hover:border-slate-200 prose-a:text-violet-700 prose-pre:text-xs"
      title="Click to edit"
      onClick={startEditing}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {value}
      </Markdown>
    </div>
  );
}
