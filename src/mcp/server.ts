import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
// The contracts remain JavaScript so the separately published stdio package can share them.
// @ts-ignore no declaration file is needed at runtime
import { TOOL_DEFS, runTool, adaptResponse } from "../../mcp/lib/tool-contracts.mjs";
import type { ContainerConfig } from "../config.ts";
import { isAuthorized, json, unauthorized } from "../http.ts";

type Transport = WebStandardStreamableHTTPServerTransport;

function safeUserId(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 120);
  return normalized || null;
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Last-Event-ID, MCP-Protocol-Version, MCP-Session-Id, X-Camofox-User-Id",
  );
  headers.set("Access-Control-Expose-Headers", "MCP-Session-Id, MCP-Protocol-Version");
  return new Response(response.body, { status: response.status, headers });
}

function createProtocolServer(config: ContainerConfig, userId: string): Server {
  const server = new Server(
    { name: "camofox-browser", version: config.packageVersion },
    {
      capabilities: { tools: {} },
      instructions: "Use snapshots to obtain refs, then click/type with those refs. Each HTTP MCP session has isolated browser storage.",
    },
  );
  const baseUrl = `http://${config.coreHost}:${config.corePort}`;
  const toolConfig = {
    accessKey: config.internalAccessKey,
    apiKey: config.apiKey,
    cookiesDir: config.cookiesDir,
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!TOOL_DEFS.some((tool: any) => tool.name === name)) {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
    try {
      const { spec, payload } = await runTool(
        name,
        args || {},
        { userId, sessionKey: "default" },
        baseUrl,
        toolConfig,
      );
      return { content: adaptResponse(spec, payload) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text", text: `camofox error: ${message}` }] };
    }
  });

  return server;
}

export function createMcpHandler(config: ContainerConfig) {
  const transports = new Map<string, Transport>();

  return async function handleMcp(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (!isAuthorized(request, config)) return cors(unauthorized());

    const sessionId = request.headers.get("mcp-session-id") || "";
    let transport = sessionId ? transports.get(sessionId) : undefined;
    let parsedBody: unknown;

    if (request.method === "POST") {
      try {
        parsedBody = await request.clone().json();
      } catch {
        return cors(json({ jsonrpc: "2.0", error: { code: -32700, message: "Invalid JSON" }, id: null }, 400));
      }
    }

    if (!transport && request.method === "POST" && isInitializeRequest(parsedBody)) {
      const requestedUserId = safeUserId(request.headers.get("x-camofox-user-id"));
      const userId = requestedUserId || `mcp-${randomUUID()}`;
      const closeBrowserSession = async (id: string) => {
        transports.delete(id);
        await fetch(`http://${config.coreHost}:${config.corePort}/sessions/${encodeURIComponent(userId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${config.internalAccessKey}` },
        }).catch(() => {});
      };
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => { transports.set(id, transport!); },
        onsessionclosed: closeBrowserSession,
      });
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      await createProtocolServer(config, userId).connect(transport);
    }

    if (!transport) {
      return cors(json({ jsonrpc: "2.0", error: { code: -32000, message: "Unknown or missing MCP session" }, id: null }, 404));
    }

    return cors(await transport.handleRequest(request, { parsedBody }));
  };
}
