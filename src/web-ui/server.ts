import type { ContainerConfig } from "../config.ts";
import { internalHeaders, isAuthorized, json, unauthorized } from "../http.ts";

async function coreFetch(config: ContainerConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://${config.coreHost}:${config.corePort}${path}`, {
    ...init,
    headers: internalHeaders(config, init.headers),
  });
}

export async function startWebUi(config: ContainerConfig): Promise<Bun.Server> {
  const root = new URL("./", import.meta.url);
  const [html, css, build] = await Promise.all([
    Bun.file(new URL("index.html", root)).text(),
    Bun.file(new URL("styles.css", root)).text(),
    Bun.build({ entrypoints: [new URL("client.ts", root).pathname], target: "browser", minify: true }),
  ]);
  if (!build.success || !build.outputs[0]) throw new Error(`Web UI build failed: ${build.logs.join("\n")}`);
  const client = await build.outputs[0].text();

  return Bun.serve({
    hostname: config.host,
    port: config.webPort,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/") && !isAuthorized(request, config)) return unauthorized();
      if (url.pathname === "/api/state") return coreFetch(config, "/dashboard/state");
      if (url.pathname === "/api/screenshot") {
        const userId = url.searchParams.get("userId") || "";
        const tabId = url.searchParams.get("tabId") || "";
        if (!userId || !tabId) return json({ error: "userId and tabId are required" }, 400);
        return coreFetch(config, `/tabs/${encodeURIComponent(tabId)}/screenshot?userId=${encodeURIComponent(userId)}`);
      }
      if (url.pathname === "/api/click" && request.method === "POST") {
        const input = await request.json() as { userId?: string; tabId?: string; x?: number; y?: number };
        if (!input.userId || !input.tabId || !Number.isFinite(input.x) || !Number.isFinite(input.y)) {
          return json({ error: "userId, tabId, x, and y are required" }, 400);
        }
        return coreFetch(config, `/tabs/${encodeURIComponent(input.tabId)}/click`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: input.userId, coordinates: { x: input.x, y: input.y } }),
        });
      }
      if (url.pathname === "/client.js") return new Response(client, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
      if (url.pathname === "/styles.css") return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8" } });
      if (url.pathname === "/" || url.pathname === "/index.html") return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response("Not found", { status: 404 });
    },
    error(error) {
      console.error("[web-ui]", error);
      return json({ error: "Web UI error" }, 500);
    },
  });
}
