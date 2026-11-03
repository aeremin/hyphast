import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {Graph, NODE_KINDS, NODE_STATUSES, isOpen, type GraphNode} from "./model.js";
import {
  UserError, createNodes, deleteNodes, loadGraph, loadMembers, updateNodes,
  type Member,
} from "./store.js";

const INSTRUCTIONS = `Hyphast is a shared task tracker for a household (a couple), organized as a graph.

Hierarchy: area > project > task. Areas are broad fields of work (e.g. "Embedded"), projects are
efforts on one specific thing (e.g. one device, hardware and firmware), tasks are concrete steps.
Tasks can have subtasks (a task's parent may be another task). Besides the hierarchy there are
dependency links ("blockedBy": this node can't start until those are finished) and undirected
"related" links.

Statuses: todo, in_progress, done, dropped. A task is "actionable" when it is open, none of its
blockers (or its ancestors' blockers) are open and it has no open subtasks.

Start with get_tree to see the structure and ids, or list_nodes with filter "actionable" to find
what can be done next. Create many nodes at once with create_nodes, using "ref" to link new
nodes to each other. Assignees can be given as "me", an email or a member's name; new tasks are
assigned to their creator unless told otherwise.`;

const MARK: Record<string, string> = {todo: "[ ]", in_progress: "[~]", done: "[x]", dropped: "[-]"};

function nodeLine(g: Graph, n: GraphNode, members: Member[]): string {
  const parts = [n.kind === "task" ? `${MARK[n.status]} ${n.title}` : `${n.kind.toUpperCase()}: ${n.title}`];
  if (n.kind !== "task") {
    const {open, total} = g.taskCounts(n.id);
    parts.push(`(${n.status}, ${open}/${total} tasks open)`);
  }
  parts.push(`#${n.id}`);
  if (n.assignee) parts.push(`@${memberName(n.assignee, members)}`);
  if (n.due) parts.push(`due ${n.due}`);
  const blockers = g.openBlockers(n);
  if (isOpen(n.status) && blockers.length) {
    parts.push(`BLOCKED by ${blockers.map((b) => `"${b.title}" #${b.id}`).join(", ")}`);
  }
  if (g.isActionable(n)) parts.push("(actionable)");
  return parts.join(" ");
}

function memberName(email: string, members: Member[]): string {
  return members.find((m) => m.email === email)?.name || email;
}

function summary(g: Graph, n: GraphNode, members: Member[]) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    status: n.status,
    path: g.ancestors(n).map((a) => a.title).join(" > "),
    assignee: n.assignee ? memberName(n.assignee, members) : null,
    due: n.due,
    openBlockers: g.openBlockers(n).map((b) => ({id: b.id, title: b.title})),
    actionable: g.isActionable(n),
  };
}

function text(value: unknown) {
  return {content: [{type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2)}]};
}

/** Runs a tool body, turning validation errors into tool errors the agent can read. */
async function run(body: () => Promise<unknown>) {
  try {
    return text(await body());
  } catch (err) {
    if (err instanceof UserError) return {...text(`Error: ${err.message}`), isError: true};
    throw err;
  }
}

const status = z.enum(NODE_STATUSES as [string, ...string[]]);
const kind = z.enum(NODE_KINDS as [string, ...string[]]);

export function buildServer(me: string): McpServer {
  const server = new McpServer({name: "hyphast", version: "0.1.0"}, {instructions: INSTRUCTIONS});

  server.registerTool("get_tree", {
    title: "Show the task tree",
    description: "Outline of areas, projects and tasks with ids, statuses, assignees, due dates and blockers. " +
      "Closed (done/dropped) nodes are hidden unless includeClosed is set.",
    inputSchema: {
      rootId: z.string().optional().describe("Only show this node and what's below it"),
      includeClosed: z.boolean().optional().describe("Also show done and dropped nodes (default false)"),
      maxDepth: z.number().int().min(1).optional().describe("How many levels below the root to show"),
    },
    annotations: {readOnlyHint: true},
  }, ({rootId, includeClosed, maxDepth}) => run(async () => {
    const [g, members] = await Promise.all([loadGraph(), loadMembers()]);
    const lines: string[] = [];
    const walk = (n: GraphNode, depth: number) => {
      if (!includeClosed && !isOpen(n.status) && n.id !== rootId) return;
      lines.push("  ".repeat(depth) + nodeLine(g, n, members));
      if (maxDepth !== undefined && depth >= maxDepth) return;
      for (const c of g.children(n.id)) walk(c, depth + 1);
    };
    if (rootId) {
      const root = g.get(rootId);
      if (!root) throw new UserError(`Unknown node "${rootId}"`);
      if (g.ancestors(root).length) lines.push(`(in ${g.path(root)})`);
      walk(root, 0);
    } else {
      for (const r of g.roots()) walk(r, 0);
    }
    const header = `Members: ${members.map((m) => `${m.name} <${m.email}>`).join(", ")}. You are ${me}.`;
    return [header, "", ...(lines.length ? lines : ["(empty - create an area to start)"])].join("\n");
  }));

  server.registerTool("list_nodes", {
    title: "Find nodes",
    description: "Flat list of nodes matching filters, e.g. everything actionable for one person, or all " +
      "blocked tasks in a project.",
    inputSchema: {
      filter: z.enum(["open", "actionable", "blocked", "in_progress", "closed", "all"]).optional()
        .describe("open (default): todo or in progress; actionable: can be worked on now; " +
          "blocked: waiting for an open blocker; closed: done or dropped"),
      kind: kind.optional(),
      rootId: z.string().optional().describe("Only nodes below this area/project/task"),
      assignee: z.string().optional().describe("\"me\", an email, a member's name, or \"none\" for unassigned"),
      query: z.string().optional().describe("Case-insensitive text to look for in titles and notes"),
      dueBefore: z.string().optional().describe("Only nodes due on or before this date (YYYY-MM-DD)"),
      limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
    },
    annotations: {readOnlyHint: true},
  }, (args) => run(async () => {
    const [g, members] = await Promise.all([loadGraph(), loadMembers()]);
    const filter = args.filter ?? "open";
    let assignee: string | null | undefined;
    if (args.assignee === "none") assignee = null;
    else if (args.assignee) {
      const v = args.assignee.toLowerCase();
      assignee = v === "me" ? me : members.find((m) => m.email === v || m.name.toLowerCase().startsWith(v))?.email;
      if (!assignee) throw new UserError(`Unknown assignee "${args.assignee}"`);
    }
    const q = args.query?.toLowerCase();
    let nodes = args.rootId ? g.descendants(args.rootId) : g.nodes;
    nodes = nodes.filter((n) => {
      if (args.kind && n.kind !== args.kind) return false;
      if (assignee !== undefined && n.assignee !== assignee) return false;
      if (q && !n.title.toLowerCase().includes(q) && !n.notes.toLowerCase().includes(q)) return false;
      if (args.dueBefore && (!n.due || n.due > args.dueBefore)) return false;
      switch (filter) {
      case "open": return g.isEffectivelyOpen(n);
      case "actionable": return g.isActionable(n);
      case "blocked": return g.isBlocked(n);
      case "in_progress": return n.status === "in_progress" && g.isEffectivelyOpen(n);
      case "closed": return !isOpen(n.status);
      default: return true;
      }
    });
    nodes.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || g.path(a).localeCompare(g.path(b)));
    const limit = args.limit ?? 100;
    return {
      total: nodes.length,
      nodes: nodes.slice(0, limit).map((n) => summary(g, n, members)),
      ...(nodes.length > limit ? {truncated: true} : {}),
    };
  }));

  server.registerTool("get_node", {
    title: "Get node details",
    description: "Everything about one node: notes, path, children, blockers, what it blocks, related nodes.",
    inputSchema: {id: z.string()},
    annotations: {readOnlyHint: true},
  }, ({id}) => run(async () => {
    const [g, members] = await Promise.all([loadGraph(), loadMembers()]);
    const n = g.get(id);
    if (!n) throw new UserError(`Unknown node "${id}"`);
    const brief = (x: GraphNode) => ({id: x.id, kind: x.kind, title: x.title, status: x.status});
    return {
      ...summary(g, n, members),
      notes: n.notes,
      parent: g.parent(n) ? brief(g.parent(n) as GraphNode) : null,
      children: g.children(n.id).map(brief),
      blockedBy: g.blockers(n).map(brief),
      blocks: g.blocks(n.id).map(brief),
      related: g.relatedNodes(n.id).map(brief),
      ...(n.kind !== "task" ? {taskCounts: g.taskCounts(n.id)} : {}),
    };
  }));

  server.registerTool("create_nodes", {
    title: "Create nodes",
    description: "Create one or many areas/projects/tasks in a single call. Give each new node a \"ref\" to use " +
      "it as the parent, blocker or related node of other items in the same call. kind defaults from the " +
      "parent (none → area, area → project, project/task → task).",
    inputSchema: {
      nodes: z.array(z.object({
        ref: z.string().optional().describe("Temporary name to refer to this node within the call"),
        kind: kind.optional(),
        title: z.string(),
        parent: z.string().optional().describe("Id of an existing node or ref of a new one"),
        notes: z.string().optional().describe("Markdown"),
        status: status.optional().describe("Default todo"),
        assignee: z.string().nullable().optional()
          .describe("Tasks default to you (the token's owner); null leaves the task unassigned"),
        due: z.string().nullable().optional().describe("YYYY-MM-DD"),
        blockedBy: z.array(z.string()).optional().describe("Ids or refs of nodes that must be finished first"),
        related: z.array(z.string()).optional().describe("Ids or refs of related nodes"),
      })).min(1),
    },
  }, ({nodes}) => run(async () => {
    const created = await createNodes(nodes as Parameters<typeof createNodes>[0], me);
    return {
      created: created.map((n, i) => ({
        ...(nodes[i].ref ? {ref: nodes[i].ref} : {}), id: n.id, kind: n.kind, title: n.title,
      })),
    };
  }));

  server.registerTool("update_nodes", {
    title: "Update nodes",
    description: "Change one or many nodes: status (e.g. mark done), title, notes, assignee, due date, parent " +
      "(move), and add/remove dependency or related links. Only the given fields change.",
    inputSchema: {
      updates: z.array(z.object({
        id: z.string(),
        title: z.string().optional(),
        notes: z.string().optional().describe("Replaces the notes (Markdown)"),
        status: status.optional(),
        assignee: z.string().nullable().optional().describe("null to unassign"),
        due: z.string().nullable().optional().describe("YYYY-MM-DD, or null to clear"),
        parent: z.string().optional().describe("Move under this node"),
        addBlockedBy: z.array(z.string()).optional(),
        removeBlockedBy: z.array(z.string()).optional(),
        addRelated: z.array(z.string()).optional(),
        removeRelated: z.array(z.string()).optional(),
      })).min(1),
    },
  }, ({updates}) => run(async () => {
    const changed = await updateNodes(updates as Parameters<typeof updateNodes>[0], me);
    return {updated: changed.map((n) => ({id: n.id, title: n.title, status: n.status}))};
  }));

  server.registerTool("delete_nodes", {
    title: "Delete nodes",
    description: "Permanently delete nodes. Prefer setting status to done or dropped, which keeps history. " +
      "Nodes with children need recursive: true, which deletes the whole subtree.",
    inputSchema: {
      ids: z.array(z.string()).min(1),
      recursive: z.boolean().optional(),
    },
    annotations: {destructiveHint: true},
  }, ({ids, recursive}) => run(async () => {
    const deleted = await deleteNodes(ids, !!recursive, me);
    return {deleted: deleted.map((n) => ({id: n.id, title: n.title}))};
  }));

  return server;
}
