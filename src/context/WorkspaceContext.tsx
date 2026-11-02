import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Graph, type GraphNode } from '../lib/model';
import { emailOf, useCurrentUser } from './AuthContext';
import Spinner from '../components/Spinner';

export interface Member {
  email: string;
  name: string;
  photoURL?: string;
}

interface Workspace {
  graph: Graph;
  members: Member[];
  me: string;
}

const WorkspaceContext = createContext<Workspace | null>(null);

type State = { status: 'loading' } | { status: 'denied' } | { status: 'error'; message: string } | { status: 'ready' };

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const me = emailOf(user);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [nodes, setNodes] = useState<GraphNode[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);

  useEffect(() => {
    const fail = (err: { code?: string; message: string }) =>
      setState(err.code === 'permission-denied' ? { status: 'denied' } : { status: 'error', message: err.message });
    const unsubMembers = onSnapshot(
      collection(db, 'members'),
      (snap) =>
        setMembers(
          snap.docs.map((d) => ({ email: d.id, name: d.get('name') || d.id, photoURL: d.get('photoURL') })),
        ),
      fail,
    );
    const unsubNodes = onSnapshot(
      collection(db, 'nodes'),
      (snap) => {
        setNodes(
          snap.docs.map((d) => {
            const data = d.data({ serverTimestamps: 'estimate' });
            return {
              id: d.id,
              kind: data.kind,
              title: data.title,
              notes: data.notes ?? '',
              status: data.status,
              parentId: data.parentId ?? null,
              assignee: data.assignee ?? null,
              due: data.due ?? null,
              blockedBy: data.blockedBy ?? [],
              related: data.related ?? [],
              createdMs: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now(),
            };
          }),
        );
        setState({ status: 'ready' });
      },
      fail,
    );
    return () => {
      unsubMembers();
      unsubNodes();
    };
  }, []);

  // Keep our own member entry's name and photo current (this is also how the owner gets an entry).
  useEffect(() => {
    if (state.status !== 'ready' || !members) return;
    const mine = members.find((m) => m.email === me);
    const name = user.displayName ?? me;
    if (mine && mine.name === name && mine.photoURL === (user.photoURL ?? undefined)) return;
    setDoc(
      doc(db, 'members', me),
      {
        name,
        ...(user.photoURL ? { photoURL: user.photoURL } : {}),
        ...(mine ? {} : { addedBy: me, addedAt: serverTimestamp() }),
      },
      { merge: true },
    ).catch((err) => console.error('Updating member entry failed', err));
  }, [state.status, members, me, user.displayName, user.photoURL]);

  const value = useMemo(
    () => (nodes && members ? { graph: new Graph(nodes), members, me } : null),
    [nodes, members, me],
  );

  if (state.status === 'denied') return <NotAMember email={me} />;
  if (state.status === 'error') return <p className="p-6 text-red-600">Failed to load: {state.message}</p>;
  if (!value) return <Spinner fullScreen />;
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace called outside WorkspaceProvider');
  return ws;
}

export function memberName(members: Member[], email: string | null) {
  if (!email) return '';
  return members.find((m) => m.email === email)?.name ?? email;
}

export function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

function NotAMember({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-sm space-y-2 text-center">
        <h1 className="text-lg font-semibold">No access yet</h1>
        <p className="text-sm text-slate-600">
          <b>{email}</b> isn't a member of this workspace. Ask a member to add this email on the Settings page, then
          reload.
        </p>
      </div>
    </div>
  );
}
