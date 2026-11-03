# Hyphast

A shared task tracker for a household, shown as a graph. Built with React, TypeScript, Vite, Tailwind CSS,
React Flow and Firebase (Authentication, Cloud Firestore, Cloud Functions, Hosting).

- **Area › Project › Task** hierarchy; tasks can have subtasks to any depth
- **Sidebar**: areas as collapsible sections listing their projects, with open task counts; **+** adds an area or
  a project, ✎ edits an area. Picking a project shows it in the graph; the URL (`/?project=…`) links to it
- **Graph view**: one project at a time, its tasks laid out left to right as a tree
  - Collapse any node (its badge shows how many nodes are hidden); done and dropped nodes are hidden unless
    **Show done** is on. Collapsed sections and nodes and the last project are remembered per device
  - Quick add: select a node and press <kbd>Tab</kbd> (or hover and click **+ task**), type, <kbd>Enter</kbd>,
    type the next one… Pasting a list adds one child per line
  - Keyboard: arrows move around the tree, <kbd>Enter</kbd> adds a sibling, <kbd>Space</kbd> toggles done,
    <kbd>C</kbd> collapses, <kbd>/</kbd> searches, <kbd>?</kbd> lists everything
- **Dependencies** ("blocked by"): drag from a node's orange dot onto another node. Open dependencies are
  dashed orange arrows; blocked tasks are amber. Dependency cycles are refused
- **Related** links: same drag with the link mode set to **Related**; drawn as dotted lines
- Links into a collapsed subtree are drawn to the collapsed node; links to other projects are listed in the side
  panel (the node still shows as blocked)
- Side panel: status, assignee, due date, notes (Markdown), links, move, delete
- New tasks are assigned to whoever created them (in the app or through MCP); change or clear it in the side panel
- **Next** page: what can be done right now (open, not blocked, no open subtasks), grouped by project — the
  view for a phone
- **Shared workspace**: every member sees and edits everything. Members are added by email on the Settings page
- **Agent access** through an MCP server (see below)
- Works offline: edits apply instantly and sync when back online

## Agent access (MCP)

`https://hyphast.aerem.in/mcp` is a stateless [MCP](https://modelcontextprotocol.io) server (Streamable
HTTP). Create an API token on the Settings page; it acts as you. Then, for Claude Code:

```sh
claude mcp add --transport http --scope user hyphast https://hyphast.aerem.in/mcp --header "Authorization: Bearer hyp_…"
```

`--scope user` makes it available in every folder, including this repo (which deliberately has no `.mcp.json`:
a project entry named `hyphast` would take precedence over the user one).
Clients that can't send headers (e.g. claude.ai custom connectors) can put the token in the URL instead:
`https://hyphast.aerem.in/mcp/hyp_…` — keep such URLs private, as they end up in request logs.

| Tool | What it does |
| --- | --- |
| `get_tree` | Outline of areas/projects/tasks with ids, statuses, assignees, due dates, blockers |
| `list_nodes` | Filtered flat list: `open`, `actionable`, `blocked`, `in_progress`, `closed`; by assignee, subtree, text, due date |
| `get_node` | One node with notes, children, blockers, what it blocks, related nodes |
| `create_nodes` | Create many nodes in one call; `ref`s let new nodes be parents/blockers of each other |
| `update_nodes` | Status, title, notes, assignee, due, move, add/remove dependencies and related links |
| `delete_nodes` | Permanent delete (`recursive` for subtrees); prefer status `done`/`dropped` |

Tokens are stored as SHA-256 hashes in `apiTokens/{hash}`; revoking one on the Settings page deletes it.

## Setup

The app is wired to the `hyphast-946ea` Firebase project; its web config is inlined in `src/lib/firebase.ts`
(these values are public by design).

```sh
npm install
npm --prefix functions install
npm run dev
```

The owner email (`a.eremin.msu@gmail.com`) is hard-coded as a member in `firestore.rules` and
`functions/src/store.ts`, so the workspace can be bootstrapped; everyone else is added on the Settings page.

### Local development with emulators

The emulators need Java 21+.

```sh
npm run emulators         # auth, firestore, functions and hosting (MCP at http://127.0.0.1:5000/mcp)
npm run dev:emulators     # the web app against the emulators
```

In emulator mode, `window.emulatorSignIn(email, name)` signs in without the Google popup (for automated tests).

## Deploying

```sh
firebase deploy                     # rules, functions (needs the Blaze plan), hosting, Google sign-in
npm run deploy                      # builds the web app first, then the same
```

The site is served at `https://hyphast.aerem.in` (and `https://hyphast-946ea.web.app`): a custom domain in
Firebase Hosting, a CNAME to `hyphast-946ea.web.app` in the `aerem.in` Cloud DNS zone (project `alice-larp`), and
an authorized domain under Authentication → Settings.

Pushes to `main` deploy hosting through `.github/workflows/firebase-hosting-merge.yml` (pull requests get a
preview channel). They need a `FIREBASE_SERVICE_ACCOUNT_HYPHAST_946EA` repository secret, which
`firebase init hosting:github` creates. Rules and functions are deployed with the CLI.

## Data model

```
nodes/{id}
  kind: area | project | task
  title, notes (Markdown)
  status: todo | in_progress | done | dropped
  parentId: null for areas; an area for projects; a project or a task for tasks
  assignee: member email or null
  due: YYYY-MM-DD or null
  blockedBy: [node ids that must be finished first]
  related: [node ids]  (undirected; stored on one side)
  createdBy, updatedBy (emails), createdAt (orders siblings), updatedAt, completedAt

members/{email}       name, photoURL, addedBy, addedAt
apiTokens/{sha256}    email, name, createdAt, lastUsedAt
```

The graph logic (actionable, blocked, cycles, valid parents) lives in `functions/src/model.ts` and is shared by
the web app and the MCP server.
