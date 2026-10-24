import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { startWebUi } from "../../src/web-ui/server.ts";
import { containerConfig } from "../../src/config.ts";

type Seen = { method: string; path: string; headers: Headers; body: unknown };

// A stand-in for the browser core: records what the web UI forwards to it.
const seen: Seen[] = [];
const core = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    seen.push({ method: request.method, path: url.pathname + url.search, headers: request.headers, body: text ? JSON.parse(text) : null });
    return Response.json({ ok: true, entries: [], result: "selected sample" });
  },
});

const baseConfig = { ...containerConfig, host: "127.0.0.1", webPort: 0, coreHost: "127.0.0.1", corePort: core.port!, internalAccessKey: "internal-test" };
let open: Bun.Server;
let secured: Bun.Server;
const url = (server: Bun.Server, path: string) => `http://127.0.0.1:${server.port}${path}`;
const post = (server: Bun.Server, path: string, body: unknown) =>
  fetch(url(server, path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  open = await startWebUi({ ...baseConfig, publicAccessKey: "" });
  secured = await startWebUi({ ...baseConfig, publicAccessKey: "secret" });
});
afterAll(() => { open.stop(true); secured.stop(true); core.stop(true); });

const lastSeen = () => seen.at(-1)!;

describe("static assets", () => {
  test("serves the current index.html, styles.css, and a built client", async () => {
    const root = new URL("../../src/web-ui/", import.meta.url);
    expect(await (await fetch(url(open, "/"))).text()).toBe(readFileSync(new URL("index.html", root), "utf8"));
    expect(await (await fetch(url(open, "/styles.css"))).text()).toBe(readFileSync(new URL("styles.css", root), "utf8"));
    const client = await fetch(url(open, "/client.js"));
    expect(client.headers.get("content-type")).toContain("javascript");
    expect((await client.text()).length).toBeGreaterThan(1000);
  });
});

describe("/api/keyboard", () => {
  test("text is typed into the focused element", async () => {
    const response = await post(open, "/api/keyboard", { userId: "u1", tabId: "t/1", text: "hello" });
    expect(response.status).toBe(200);
    expect(lastSeen()).toMatchObject({ method: "POST", path: "/tabs/t%2F1/type", body: { userId: "u1", text: "hello", mode: "keyboard", delay: 0 } });
  });

  test("key is pressed", async () => {
    await post(open, "/api/keyboard", { userId: "u1", tabId: "t1", key: "Control+a" });
    expect(lastSeen()).toMatchObject({ path: "/tabs/t1/press", body: { userId: "u1", key: "Control+a" } });
  });

  test("an empty string is still valid text", async () => {
    expect((await post(open, "/api/keyboard", { userId: "u1", tabId: "t1", text: "" })).status).toBe(200);
  });

  test("rejects requests without a target or input", async () => {
    const count = seen.length;
    expect((await post(open, "/api/keyboard", { tabId: "t1", text: "x" })).status).toBe(400);
    expect((await post(open, "/api/keyboard", { userId: "u1", text: "x" })).status).toBe(400);
    expect((await post(open, "/api/keyboard", { userId: "u1", tabId: "t1" })).status).toBe(400);
    expect(seen.length).toBe(count);
  });
});

describe("/api/activity", () => {
  test("proxies to the core with the since cursor", async () => {
    await fetch(url(open, "/api/activity?tabId=t1&since=7"));
    expect(lastSeen()).toMatchObject({ method: "GET", path: "/dashboard/tabs/t1/activity?since=7" });
  });

  test("defaults since to 0 and requires tabId", async () => {
    await fetch(url(open, "/api/activity?tabId=t1"));
    expect(lastSeen().path).toBe("/dashboard/tabs/t1/activity?since=0");
    expect((await fetch(url(open, "/api/activity"))).status).toBe(400);
  });
});

describe("core requests", () => {
  test("carry the internal key and the dashboard source label", async () => {
    await post(open, "/api/click", { userId: "u1", tabId: "t1", x: 1, y: 2 });
    expect(lastSeen().headers.get("authorization")).toBe("Bearer internal-test");
    expect(lastSeen().headers.get("x-bwl-source")).toBe("dashboard");
    expect(lastSeen()).toMatchObject({ path: "/tabs/t1/click", body: { userId: "u1", coordinates: { x: 1, y: 2 } } });
  });
});

describe("auth", () => {
  test("api routes require the access key when configured", async () => {
    expect((await fetch(url(secured, "/api/activity?tabId=t1"))).status).toBe(401);
    expect((await post(secured, "/api/keyboard", { userId: "u", tabId: "t", key: "a" })).status).toBe(401);
    const ok = await fetch(url(secured, "/api/activity?tabId=t1"), { headers: { Authorization: "Bearer secret" } });
    expect(ok.status).toBe(200);
  });

  test("config and the page itself stay public", async () => {
    expect(await (await fetch(url(secured, "/api/config"))).json()).toEqual({ authRequired: true, mcpUrl: `http://127.0.0.1:${containerConfig.mcpPort}/mcp` });
    expect((await fetch(url(secured, "/"))).status).toBe(200);
  });
});

describe("/api/clipboard", () => {
  test("returns selected text from the targeted remote page", async () => {
    const response = await post(open, "/api/clipboard", { userId: "u1", tabId: "t/1" });
    expect(await response.json()).toEqual({ text: "selected sample" });
    expect(lastSeen()).toMatchObject({ method: "POST", path: "/tabs/t%2F1/evaluate" });
    expect((lastSeen().body as { userId: string }).userId).toBe("u1");
  });
  test("requires a target and authorization", async () => {
    expect((await post(open, "/api/clipboard", { userId: "u1" })).status).toBe(400);
    expect((await post(secured, "/api/clipboard", { userId: "u1", tabId: "t1" })).status).toBe(401);
  });
});

describe('tab protection and recovery', () => {
  test('forwards viewing lease and pin controls with dashboard auth', async () => {
    const response = await post(open, '/api/lifetime', { userId: 'u1', tabId: 't1', keepOpen: true, viewing: true });
    expect(response.status).toBe(200);
    expect(lastSeen()).toMatchObject({ method: 'POST', path: '/tabs/t1/lifetime', body: { userId: 'u1', keepOpen: true, viewing: true } });
    expect(lastSeen().headers.get('authorization')).toBe('Bearer internal-test');
  });
  test('rejects malformed or unauthorized protection requests', async () => {
    expect((await post(open, '/api/lifetime', { userId: 'u1', tabId: 't1', keepOpen: 'yes' })).status).toBe(400);
    expect((await post(secured, '/api/lifetime', { userId: 'u1', tabId: 't1', keepOpen: true })).status).toBe(401);
  });
  test('reopens saved HTTP URLs and rejects non-navigation schemes', async () => {
    expect((await post(open, '/api/reopen', { userId: 'u1', url: 'https://example.test/chat', sessionKey: 'chat' })).status).toBe(200);
    expect(lastSeen()).toMatchObject({ method: 'POST', path: '/tabs', body: { userId: 'u1', url: 'https://example.test/chat', sessionKey: 'chat' } });
    expect((await post(open, '/api/reopen', { userId: 'u1', url: 'javascript:alert(1)' })).status).toBe(400);
  });
  test('reads recovery history for the selected user and tab', async () => {
    await fetch(url(open, '/api/history?userId=u1&tabId=t1'));
    expect(lastSeen()).toMatchObject({ method: 'GET', path: '/tabs/t1/history?userId=u1' });
  });
});

describe("/api/profiles/delete", () => {
  test("deletes the named profile in the core", async () => {
    await post(open, "/api/profiles/delete", { profile: "my shop" });
    expect(lastSeen()).toMatchObject({ method: "DELETE", path: "/profiles/my%20shop" });
  });

  test("requires a profile and authorization", async () => {
    expect((await post(open, "/api/profiles/delete", {})).status).toBe(400);
    expect((await post(secured, "/api/profiles/delete", { profile: "x" })).status).toBe(401);
  });
});

describe("/api/config mcpUrl", () => {
  test("follows the dashboard host, honours a TLS proxy, and can be overridden", async () => {
    const viaProxy = await fetch(url(open, "/api/config"), { headers: { "X-Forwarded-Proto": "https" } });
    expect((await viaProxy.json() as { mcpUrl: string }).mcpUrl).toBe(`https://127.0.0.1:${containerConfig.mcpPort}/mcp`);
    const pinned = await startWebUi({ ...baseConfig, publicAccessKey: "", publicMcpUrl: "https://bwl.example/mcp" });
    try {
      expect((await (await fetch(url(pinned, "/api/config"))).json() as { mcpUrl: string }).mcpUrl).toBe("https://bwl.example/mcp");
    } finally { pinned.stop(true); }
  });
});

describe("/api/profiles/create", () => {
  test("creates a named or burner profile in the core", async () => {
    await post(open, "/api/profiles/create", { name: "shopping" });
    expect(lastSeen()).toMatchObject({ method: "POST", path: "/profiles", body: { name: "shopping", burner: false } });
    await post(open, "/api/profiles/create", { burner: true, screen: "1366x768" });
    expect(lastSeen()).toMatchObject({ method: "POST", path: "/profiles", body: { burner: true, screen: "1366x768" } });
  });

  test("re-rolls a profile's fingerprint in the core", async () => {
    await post(open, "/api/profiles/fingerprint", { profile: "main", screen: "1920x1080", os: "windows", locale: "fr-FR", timezone: "Europe/Paris" });
    expect(lastSeen()).toMatchObject({ method: "POST", path: "/profiles/main/fingerprint", body: { screen: "1920x1080", os: "windows", locale: "fr-FR", timezone: "Europe/Paris" } });
    expect((await post(open, "/api/profiles/fingerprint", { profile: "main", os: 5 })).status).toBe(400);
    const count = seen.length;
    expect((await post(open, "/api/profiles/fingerprint", {})).status).toBe(400);
    expect((await post(secured, "/api/profiles/fingerprint", { profile: "main" })).status).toBe(401);
    expect(seen.length).toBe(count);
  });

  test("requires a name (or burner) and authorization", async () => {
    const count = seen.length;
    expect((await post(open, "/api/profiles/create", {})).status).toBe(400);
    expect((await post(open, "/api/profiles/create", { name: 5 })).status).toBe(400);
    expect((await post(secured, "/api/profiles/create", { name: "x" })).status).toBe(401);
    expect(seen.length).toBe(count);
  });
});
