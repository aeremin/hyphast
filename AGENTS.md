# Notes for coding agents

See README.md for features, the data model and the MCP tools.

## Layout

- `src/` — React web app (Vite, Tailwind 4, React Flow). Pages in `src/pages`, Firestore writes in
  `src/lib/nodes.ts`, the tree layout in `src/lib/layout.ts`.
- `functions/src/model.ts` — data model and graph helpers shared by the web app (re-exported from
  `src/lib/model.ts`) and the MCP server. It must stay import-free and pass the functions' ESLint (Google
  style, double quotes).
- `functions/src/mcp.ts`, `store.ts`, `index.ts` — the MCP server (Cloud Function `mcp`, region europe-west6,
  served at `/mcp` through a Hosting rewrite).
- `firestore.rules` — validation mirrors `NodeFields` and the `MAX_*` constants in `model.ts`; change both.

## Checks

```sh
npm run build                 # type-checks and builds the web app
npm --prefix functions run lint
npm --prefix functions run build
```

Try changes against the emulators (`npm run emulators`, `npm run dev:emulators`; Java 21+), signing in with
`window.emulatorSignIn(email, name)`. The MCP server is at `http://127.0.0.1:5000/mcp`; tokens can be created
on the Settings page.

## Working with the user's tasks

If the `hyphast` MCP server is connected (configured in the user's Claude Code user scope, not in this repo),
use it to read or update the real task graph. Start with `get_tree` or `list_nodes` with filter `actionable`. Create related tasks in one
`create_nodes` call using `ref`s. Prefer marking things `done`/`dropped` over deleting them.
