import { useEffect, useRef, useState } from 'react';
import { formatBytes, type Attachment, type GraphNode } from '../lib/model';
import { attachError, attachmentUrl, removeAttachment, uploadAttachment } from '../lib/attachments';

interface Upload {
  key: number;
  name: string;
  progress: number;
}

let uploadKey = 0;

/** The node's attachments, with upload by button, drag and drop or pasting files. */
export default function Attachments({ node, me }: { node: GraphNode; me: string }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setError(null), [node.id]);

  async function upload(files: File[]) {
    if (!files.length) return;
    const err = attachError(node, files);
    setError(err);
    if (err) return;
    await Promise.all(
      files.map(async (file) => {
        const key = ++uploadKey;
        const set = (progress: number) =>
          setUploads((us) => us.map((u) => (u.key === key ? { ...u, progress } : u)));
        setUploads((us) => [...us, { key, name: file.name, progress: 0 }]);
        try {
          await uploadAttachment(me, node.id, file, set);
        } catch (e) {
          console.error(e);
          setError(`Couldn't upload "${file.name}": ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setUploads((us) => us.filter((u) => u.key !== key));
        }
      }),
    );
  }

  function remove(a: Attachment) {
    if (!confirm(`Delete "${a.name}"?`)) return;
    removeAttachment(me, node.id, a).catch((e) => {
      console.error(e);
      setError(`Couldn't delete "${a.name}": ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  const sorted = [...node.attachments].sort((a, b) => a.uploadedAt - b.uploadedAt);

  return (
    <div
      className={`-mx-1 rounded-lg px-1 ${dragging ? 'bg-violet-50 ring-2 ring-violet-300' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        upload([...e.dataTransfer.files]);
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="label">Attachments</span>
        <span className="text-[11px] text-slate-400">Drop files here</span>
        <button
          className="ml-auto text-xs font-medium text-violet-600 hover:text-violet-800"
          onClick={() => input.current?.click()}
        >
          + Add
        </button>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      <ul className="space-y-1">
        {sorted.map((a) => (
          <AttachmentRow key={a.id} nodeId={node.id} attachment={a} onRemove={() => remove(a)} />
        ))}
        {uploads.map((u) => (
          <li key={u.key} className="flex items-center gap-2 text-sm text-slate-500">
            <span className="min-w-0 flex-1 truncate">{u.name}</span>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
              <span className="block h-full bg-violet-500" style={{ width: `${u.progress * 100}%` }} />
            </span>
          </li>
        ))}
        {sorted.length === 0 && uploads.length === 0 && <li className="text-xs text-slate-400">None</li>}
      </ul>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function AttachmentRow({
  nodeId,
  attachment: a,
  onRemove,
}: {
  nodeId: string;
  attachment: Attachment;
  onRemove: () => void;
}) {
  // Download URLs are fetched up front so the links open without a popup blocker getting in the way.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    attachmentUrl(nodeId, a)
      .then((u) => live && setUrl(u))
      .catch((e) => console.error(e));
    return () => {
      live = false;
    };
  }, [nodeId, a.id]);

  const image = a.contentType.startsWith('image/');
  return (
    <li className="group flex items-center gap-2 text-sm">
      {image && url ? (
        <img src={url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-base">📎</span>
      )}
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={`min-w-0 flex-1 truncate ${url ? 'text-slate-700 hover:text-violet-700 hover:underline' : 'text-slate-400'}`}
        title={a.name}
      >
        {a.name}
      </a>
      <span className="shrink-0 text-xs text-slate-400">{formatBytes(a.size)}</span>
      <button className="text-slate-400 hover:text-red-600" onClick={onRemove} title="Delete attachment">
        ×
      </button>
    </li>
  );
}
