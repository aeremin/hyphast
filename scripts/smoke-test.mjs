// End-to-end smoke test against the Firebase emulators: Firestore security rules and the MCP server
// (Cloud Function behind the Hosting rewrite). Run through `npm run test:emulators`, which starts the
// emulators with a demo project and runs this script.
import { createHash, randomBytes } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  terminate,
  where,
} from 'firebase/firestore';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-hyphast';
const OWNER = 'a.eremin.msu@gmail.com';
const MCP_URL = 'http://127.0.0.1:5000/mcp';

const apps = [];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${name}\n     ${err?.stack || err}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function denied(promise) {
  try {
    await promise;
  } catch (err) {
    if (err?.code === 'permission-denied') return;
    throw err;
  }
  throw new Error('expected permission-denied, but the request succeeded');
}

/** A client app signed in as `email` (or anonymous when null), like the web app in emulator mode. */
async function client(email) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT }, `app-${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  if (email) {
    const idToken = JSON.stringify({ sub: email, email, email_verified: true, name: email });
    await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  }
  return db;
}

function node(fields, me) {
  return {
    kind: 'area',
    title: 'Smoke area',
    notes: '',
    status: 'todo',
    parentId: null,
    assignee: null,
    due: null,
    blockedBy: [],
    related: [],
    createdBy: me,
    updatedBy: me,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...fields,
  };
}

let rpcId = 0;
async function mcp(method, params, token) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function callTool(name, args, token) {
  const { status, body } = await mcp('tools/call', { name, arguments: args }, token);
  assert(status === 200, `${name}: HTTP ${status} ${JSON.stringify(body)}`);
  assert(body.result && !body.result.isError, `${name} failed: ${JSON.stringify(body)}`);
  return body.result.content.map((c) => c.text ?? '').join('\n');
}

const anon = await client(null);
const outsider = await client('outsider@example.com');
const owner = await client(OWNER);
const areaId = `smoke-${randomBytes(4).toString('hex')}`;
const token = `hyp_${randomBytes(24).toString('base64url')}`;

// Firestore rules

await check('rules: anonymous users cannot read nodes', () => denied(getDocs(collection(anon, 'nodes'))));
await check('rules: non-members cannot read nodes', () => denied(getDocs(collection(outsider, 'nodes'))));
await check('rules: non-members cannot create nodes', () =>
  denied(setDoc(doc(outsider, 'nodes', 'x'), node({}, 'outsider@example.com'))));
await check('rules: the owner can create a valid area', () =>
  setDoc(doc(owner, 'nodes', areaId), node({ title: 'Smoke area' }, OWNER)));
await check('rules: invalid nodes are rejected', async () => {
  await denied(setDoc(doc(owner, 'nodes', 'bad-kind'), node({ kind: 'bogus' }, OWNER)));
  await denied(setDoc(doc(owner, 'nodes', 'bad-title'), node({ title: '' }, OWNER)));
  await denied(setDoc(doc(owner, 'nodes', 'bad-field'), node({ extra: 1 }, OWNER)));
  await denied(setDoc(doc(owner, 'nodes', 'bad-parent'), node({ kind: 'task' }, OWNER)));
  await denied(setDoc(doc(owner, 'nodes', 'spoofed'), node({ updatedBy: 'someone@example.com' }, OWNER)));
});
await check('rules: members can create their own API token', () =>
  setDoc(doc(owner, 'apiTokens', createHash('sha256').update(token).digest('hex')), {
    email: OWNER,
    name: 'smoke test',
    createdAt: serverTimestamp(),
  }));
await check('rules: tokens cannot be created for someone else', () =>
  denied(setDoc(doc(owner, 'apiTokens', 'other'), { email: 'someone@example.com', name: 'x' })));

// MCP server through the Hosting rewrite

await check('mcp: GET is rejected with 405', async () => {
  const res = await fetch(MCP_URL);
  assert(res.status === 405, `HTTP ${res.status}`);
});
await check('mcp: requests without a token get 401', async () => {
  const { status } = await mcp('tools/list', {});
  assert(status === 401, `HTTP ${status}`);
});
await check('mcp: unknown tokens get 401', async () => {
  const { status } = await mcp('tools/list', {}, 'hyp_unknown');
  assert(status === 401, `HTTP ${status}`);
});
await check('mcp: initialize', async () => {
  const { status, body } = await mcp(
    'initialize',
    { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-test', version: '1' } },
    token,
  );
  assert(status === 200 && body.result?.serverInfo, `HTTP ${status} ${JSON.stringify(body)}`);
});
await check('mcp: tools/list', async () => {
  const { status, body } = await mcp('tools/list', {}, token);
  assert(status === 200, `HTTP ${status} ${JSON.stringify(body)}`);
  const names = body.result.tools.map((t) => t.name);
  for (const t of ['get_tree', 'list_nodes', 'get_node', 'create_nodes', 'update_nodes', 'delete_nodes']) {
    assert(names.includes(t), `missing tool ${t} in ${names.join(', ')}`);
  }
});
await check('mcp: create_nodes writes to Firestore', async () => {
  await callTool('create_nodes', {
    nodes: [
      { ref: 'p', title: 'Smoke project', parent: areaId },
      { title: 'Smoke task', parent: 'p' },
    ],
  }, token);
  const snap = await getDocs(query(collection(owner, 'nodes'), where('title', '==', 'Smoke task')));
  assert(snap.size === 1, `expected 1 task, found ${snap.size}`);
  const task = snap.docs[0].data();
  assert(task.kind === 'task' && task.assignee === OWNER, `unexpected task ${JSON.stringify(task)}`);
});
await check('mcp: get_tree shows the new nodes', async () => {
  const text = await callTool('get_tree', {}, token);
  for (const t of ['Smoke area', 'Smoke project', 'Smoke task']) assert(text.includes(t), `missing "${t}":\n${text}`);
});
await check('mcp: list_nodes actionable', async () => {
  const text = await callTool('list_nodes', { filter: 'actionable' }, token);
  assert(text.includes('Smoke task'), `missing "Smoke task":\n${text}`);
});

for (const app of apps) {
  await terminate(getFirestore(app));
  await deleteApp(app);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
