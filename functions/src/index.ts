import {createHash} from "node:crypto";
import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import {initializeApp} from "firebase-admin/app";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {buildServer} from "./mcp.js";
import {authenticate} from "./store.js";

initializeApp();

// Same location as the Firestore database (see firebase.json).
setGlobalOptions({maxInstances: 10, region: "europe-west6"});

/**
 * The token comes from an `Authorization: Bearer` header or, for clients that can't send headers,
 * the last path segment (`/mcp/<token>`).
 */
function tokenOf(req: {headers: Record<string, unknown>; path: string}): string | null {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7).trim();
  const m = /\/(hyp_[A-Za-z0-9_-]+)\/?$/.exec(req.path);
  return m ? m[1] : null;
}

/**
 * Stateless MCP server (Streamable HTTP, JSON responses). Served at https://<site>/mcp through a
 * Hosting rewrite.
 */
export const mcp = onRequest({cors: true, timeoutSeconds: 60}, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0", error: {code: -32000, message: "Method not allowed. This MCP server is stateless; use POST."},
      id: null,
    });
    return;
  }
  const token = tokenOf(req);
  const email = token ? await authenticate(createHash("sha256").update(token).digest("hex")) : null;
  if (!email) {
    res.status(401).set("WWW-Authenticate", "Bearer").json({
      jsonrpc: "2.0", error: {code: -32001, message: "Missing or invalid API token. Create one in Hyphast settings."},
      id: null,
    });
    return;
  }
  const server = buildServer(email);
  const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error("MCP request failed", err);
    if (!res.headersSent) {
      res.status(500).json({jsonrpc: "2.0", error: {code: -32603, message: "Internal error"}, id: null});
    }
  }
});
