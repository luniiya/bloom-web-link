import type { ContainerConfig } from "./config.ts";
import { createMcpHandler } from "./mcp/server.ts";
import { isAuthorized, json, unauthorized, internalHeaders } from "./http.ts";

function dedicatedAuthPath(url: URL, method: string, config: ContainerConfig): boolean {
  if (config.apiKey && method === "POST" && /^\/sessions\/[^/]+\/cookies$/.test(url.pathname)) return true;
  if (config.apiKey && url.pathname.startsWith("/auth-sessions/")) return true;
  return !!config.adminKey && method === "POST" && url.pathname === "/stop";
}

async function proxyToCore(request: Request, config: ContainerConfig): Promise<Response> {
  const url = new URL(request.url);
  const dedicatedAuth = dedicatedAuthPath(url, request.method, config);
  const publicHealth = request.method === "GET" && url.pathname === "/health";
  if (!dedicatedAuth && !publicHealth && !isAuthorized(request, config)) return unauthorized();

  const target = new URL(url.pathname + url.search, `http://${config.coreHost}:${config.corePort}`);
  const headers = dedicatedAuth
    ? new Headers(request.headers)
    : internalHeaders(config, request.headers);
  headers.delete("host");

  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();
  return fetch(target, { method: request.method, headers, body });
}

export function startGateway(config: ContainerConfig): Bun.Server {
  const handleMcp = createMcpHandler(config);
  return Bun.serve({
    hostname: config.host,
    port: config.mcpPort,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/mcp") return handleMcp(request);
      if (url.pathname === "/gateway/health") {
        const core = await fetch(`http://${config.coreHost}:${config.corePort}/health`).catch(() => null);
        return json({ ok: core?.ok === true, mcpEndpoint: "/mcp", webPort: config.webPort }, core?.ok ? 200 : 503);
      }
      return proxyToCore(request, config);
    },
    error(error) {
      console.error("[gateway]", error);
      return json({ error: "Gateway error" }, 500);
    },
  });
}
