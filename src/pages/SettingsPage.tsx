import { useEffect, useState, type FormEvent } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { createToken, MCP_URL } from '../lib/tokens';
import { useWorkspace } from '../context/WorkspaceContext';

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <Members />
        <ApiTokens />
      </div>
    </div>
  );
}

function Members() {
  const { members, me } = useWorkspace();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address.includes('@')) return setError('Enter an email address');
    setError(null);
    try {
      await setDoc(doc(db, 'members', address), { name: address, addedBy: me, addedAt: serverTimestamp() });
      setEmail('');
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">Members</h2>
      <p className="text-sm text-slate-600">
        Everyone here sees and edits the whole workspace. They sign in with the Google account of this email.
      </p>
      <ul className="divide-y divide-slate-100">
        {members.map((m) => (
          <li key={m.email} className="flex items-center gap-3 py-2">
            {m.photoURL ? (
              <img src={m.photoURL} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-slate-200" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{m.name}</div>
              <div className="text-xs text-slate-500">{m.email}</div>
            </div>
            {m.email !== me && (
              <button
                className="text-xs text-red-600 hover:underline"
                onClick={() => confirm(`Remove ${m.email}?`) && deleteDoc(doc(db, 'members', m.email))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={add}>
        <input
          className="input"
          type="email"
          placeholder="Add a member by email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn btn-primary">Add</button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

interface TokenRow {
  id: string;
  name: string;
  createdAt: Timestamp | null;
  lastUsedAt: Timestamp | null;
}

function ApiTokens() {
  const { me } = useWorkspace();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      onSnapshot(query(collection(db, 'apiTokens'), where('email', '==', me)), (snap) =>
        setTokens(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.get('name'),
            createdAt: d.get('createdAt'),
            lastUsedAt: d.get('lastUsedAt'),
          })),
        ),
      ),
    [me],
  );

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setCreated(await createToken(me, name.trim() || 'Agent'));
      setName('');
    } finally {
      setBusy(false);
    }
  }

  const fmt = (t: Timestamp | null) => (t ? t.toDate().toLocaleString() : 'never');

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">Agent access (MCP)</h2>
      <p className="text-sm text-slate-600">
        AI agents connect to the MCP server at <code className="rounded bg-slate-100 px-1">{MCP_URL}</code> with an
        API token. They act as you: they can read the whole graph, add tasks and mark them done.
      </p>

      <form className="flex gap-2" onSubmit={create}>
        <input
          className="input"
          placeholder="Token name, e.g. Claude Code laptop"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary whitespace-nowrap" disabled={busy}>
          Create token
        </button>
      </form>

      {created && (
        <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-800">Copy the token now; it won't be shown again.</p>
          <Copyable label="Token" value={created} />
          <Copyable
            label="Claude Code"
            value={`claude mcp add --transport http hyphast ${MCP_URL} --header "Authorization: Bearer ${created}"`}
          />
          <Copyable label="Clients without custom headers (e.g. claude.ai connectors): URL with the token" value={`${MCP_URL}/${created}`} />
          <button className="text-xs text-slate-500 hover:underline" onClick={() => setCreated(null)}>
            Done
          </button>
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t.name}</div>
              <div className="text-xs text-slate-500">
                Created {fmt(t.createdAt)} · last used {fmt(t.lastUsedAt)}
              </div>
            </div>
            <button
              className="text-xs text-red-600 hover:underline"
              onClick={() => confirm(`Revoke "${t.name}"?`) && deleteDoc(doc(db, 'apiTokens', t.id))}
            >
              Revoke
            </button>
          </li>
        ))}
        {tokens.length === 0 && <li className="py-2 text-sm text-slate-500">No tokens yet.</li>}
      </ul>
    </section>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-xs text-slate-600">{label}</div>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded border border-slate-200 bg-white px-2 py-1 text-xs whitespace-nowrap">
          {value}
        </code>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
