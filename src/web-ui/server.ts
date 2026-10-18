import { selectedText } from "./clipboard.ts";
import type { ContainerConfig } from "../config.ts";
import { internalHeaders, isAuthorized, json, unauthorized } from "../http.ts";

async function coreFetch(config: ContainerConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = internalHeaders(config, init.headers);
  // Lets the core label these calls as the dashboard's in a tab's activity log.
  headers.set("X-BWL-Source", "dashboard");
  return fetch(`http://${config.coreHost}:${config.corePort}${path}`, { ...init, headers });
}

// Assets are read and the client rebuilt on every request, so edits to
// src/web-ui (bind-mounted by compose.yaml) show up on reload without a
// container rebuild. Only the page load pays this — polling hits /api/*.
async function buildClient(root: URL): Promise<string> {
  const build = await Bun.build({ entrypoints: [new URL("client.ts", root).pathname], target: "browser", minify: true });
  if (!build.success || !build.outputs[0]) throw new Error(`Web UI build failed: ${build.logs.join("\n")}`);
  return build.outputs[0].text();
}

export async function startWebUi(config: ContainerConfig): Promise<Bun.Server> {
  const root = new URL("./", import.meta.url);
  await buildClient(root); // fail fast at startup if the client doesn't compile

  return Bun.serve({
    hostname: config.host,
    port: config.webPort,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/config") return json({ authRequired: !!config.publicAccessKey });
      if (url.pathname.startsWith("/api/") && !isAuthorized(request, config)) return unauthorized();
      if (url.pathname === "/api/state") return coreFetch(config, "/dashboard/state");
      if (url.pathname === "/api/lifetime" && request.method === "POST") {
        const input = await request.json() as { userId?: string; tabId?: string; keepOpen?: boolean; viewing?: boolean };
        if (!input.userId || !input.tabId || (input.keepOpen !== undefined && typeof input.keepOpen !== "boolean") || (input.viewing !== undefined && typeof input.viewing !== "boolean")) return json({ error: "userId and tabId required; keepOpen and viewing must be booleans" }, 400);
        return coreFetch(config, `/tabs/${encodeURIComponent(input.tabId)}/lifetime`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: input.userId, keepOpen: input.keepOpen, viewing: input.viewing }) });
      }
      if (url.pathname === "/api/history") {
        const userId = url.searchParams.get("userId"); const tabId = url.searchParams.get("tabId");
        if (!userId || !tabId) return json({ error: "userId and tabId required" }, 400);
        return coreFetch(config, `/tabs/${encodeURIComponent(tabId)}/history?${new URLSearchParams({ userId })}`);
      }
      if (url.pathname === "/api/reopen" && request.method === "POST") {
        const input = await request.json() as { userId?: string; url?: string; sessionKey?: string };
        if (!input.userId || !input.url || !/^https?:\/\//i.test(input.url)) return json({ error: "userId and an http(s) URL required" }, 400);
        return coreFetch(config, "/tabs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: input.userId, sessionKey: input.sessionKey || "default", url: input.url }) });
      }
      if (url.pathname === "/api/activity") {
        const tabId = url.searchParams.get("tabId") || "";
        if (!tabId) return json({ error: "tabId is required" }, 400);
        const since = url.searchParams.get("since") || "0";
        return coreFetch(config, `/dashboard/tabs/${encodeURIComponent(tabId)}/activity?since=${encodeURIComponent(since)}`);
      }
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
      if (url.pathname === "/api/clipboard" && request.method === "POST") {
        const input = await request.json() as { userId?: string; tabId?: string };
        if (!input.userId || !input.tabId) return json({ error: "userId and tabId are required" }, 400);
        const response = await coreFetch(config, `/tabs/${encodeURIComponent(input.tabId)}/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: input.userId, expression: selectedText.toString() }),
        });
        if (!response.ok) return response;
        const data = await response.json() as { result?: unknown };
        return json({ text: typeof data.result === "string" ? data.result : "" });
      }
      if (url.pathname === "/api/keyboard" && request.method === "POST") {
        // Keyboard input from the detail view: `text` types into whatever the
        // page has focused; `key` presses a single key/chord (Enter, Control+a).
        const input = await request.json() as { userId?: string; tabId?: string; text?: string; key?: string };
        if (!input.userId || !input.tabId || (typeof input.text !== "string" && typeof input.key !== "string")) {
          return json({ error: "userId, tabId, and text or key are required" }, 400);
        }
        const tabPath = `/tabs/${encodeURIComponent(input.tabId)}`;
        const [path, body] = typeof input.text === "string"
          ? [`${tabPath}/type`, { userId: input.userId, text: input.text, mode: "keyboard", delay: 0 }]
          : [`${tabPath}/press`, { userId: input.userId, key: input.key }];
        return coreFetch(config, path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (url.pathname === "/client.js") return new Response(await buildClient(root), { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
      if (url.pathname === "/styles.css") return new Response(await Bun.file(new URL("styles.css", root)).text(), { headers: { "Content-Type": "text/css; charset=utf-8" } });
      if (url.pathname === "/" || url.pathname === "/index.html") return new Response(await Bun.file(new URL("index.html", root)).text(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return new Response("Not found", { status: 404 });
    },
    error(error) {
      console.error("[web-ui]", error);
      return json({ error: "Web UI error" }, 500);
    },
  });
}
