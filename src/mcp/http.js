/**
 * Streamable HTTP transport for one stateless MCP request.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { resolvePublicOrigin } from "./config.js";
import { resolveBearerToken } from "./store.js";
import { createMcpServer } from "./tools.js";

function bearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (match) return match[1];
  const apiKey = req.get("x-api-key");
  return apiKey ? String(apiKey).trim() : "";
}

export function unauthorized(req, res) {
  const metadata = `${resolvePublicOrigin(req)}/.well-known/oauth-protected-resource`;
  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="bitrix-crm", resource_metadata="${metadata}", scope="mcp"`
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(401).json({ error: "invalid_token" });
}

function methodNotAllowed(res) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
}

export async function handleMcpHttp(req, res) {
  const raw = bearerToken(req);
  const auth = raw ? resolveBearerToken(raw) : null;
  if (!auth) return unauthorized(req, res);
  if (auth.user.mustChangePassword) {
    return res.status(401).json({
      error: "invalid_token",
      error_description: "Сначала смените пароль в приложении.",
    });
  }
  if (auth.credential.kind === "access" && auth.credential.resource) {
    const expected = resolvePublicOrigin(req).replace(/\/$/, "");
    const actual = String(auth.credential.resource).replace(/\/$/, "");
    if (actual !== expected) return unauthorized(req, res);
  }

  if (req.method === "GET" || req.method === "DELETE") return methodNotAllowed(res);

  const mcp = createMcpServer(auth.user);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
    const cleanup = () => {
      transport.close().catch(() => {});
      mcp.close().catch(() => {});
    };
    if (res.writableEnded || res.closed) cleanup();
    else res.on("close", cleanup);
  } catch (error) {
    transport.close().catch(() => {});
    mcp.close().catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}
