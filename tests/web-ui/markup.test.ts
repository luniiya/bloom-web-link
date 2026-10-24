import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Header } from "../../src/web-ui/components/Header.tsx";
import { browserStatus, GridView } from "../../src/web-ui/components/GridView.tsx";
import { DetailView } from "../../src/web-ui/components/DetailView.tsx";
import type { ActivityEntry } from "../../src/web-ui/activity.ts";
import type { ClosedEntry, State } from "../../src/web-ui/types.ts";

const read = (name: string) => readFileSync(new URL(`../../src/web-ui/${name}`, import.meta.url), "utf8");
const page = read("index.html");

const session = { userId: "user-abcdefghijkl", lastAccess: "2026-01-01T00:00:00Z", tabs: [
  { tabId: "t1", sessionKey: "chat", url: "https://example.test/", title: "Example", navigationError: "boom\nstack",
    lifetime: { keepOpen: false, protected: false, expiresAt: null, idleTimeoutMs: 0 } },
] };
const state: State = { running: true, generatedAt: "2026-01-01T00:00:00Z", sessions: [session] };
const last: ClosedEntry = { session: { ...session, tabs: [] }, tab: { tabId: "t2", sessionKey: "chat", url: "https://example.test/old", title: "Old" }, closedAt: 1, reason: "idle_timeout" };
const activity: ActivityEntry[] = [{ seq: 1, ts: "2026-01-01T00:00:00Z", action: "click", detail: "button", status: 500, ms: 12, source: "dashboard" }];
const noop = () => {};
const detailProps = { state, activity, onStatus: noop, refresh: async () => {} };

const header = renderToStaticMarkup(h(Header, { theme: "auto", onThemeChange: noop, authHidden: false, onAuth: noop,
  connect: { mcpUrl: "http://localhost:9377/mcp", authRequired: false }, profiles: ["main", "work"] }));
const grid = renderToStaticMarkup(h(GridView, { hidden: false, state, open: [{ session, tab: session.tabs[0]! }], closed: [last] }));
const openDetail = renderToStaticMarkup(h(DetailView, { ...detailProps, userId: session.userId, tabId: "t1" }));
const closedDetail = renderToStaticMarkup(h(DetailView, { ...detailProps, userId: session.userId, tabId: "t2", last }));
const html = [header, grid, openDetail, closedDetail].join("\n");

describe("index.html", () => {
  test("is a shell that loads the React client", () => {
    expect(page).toContain('<div id="root"></div>');
    expect(page).toContain('<script type="module" src="/client.js"></script>');
    expect(read("client.tsx")).toContain('getElementById("root")');
  });
});

describe("rendered markup", () => {
  test("no <p> contains block-level children (the browser would split it)", () => {
    // Regression: <p hidden><h2>Tab closed</h2></p> left "Tab closed" visible on open tabs.
    for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
      expect(match[1]).not.toMatch(/<(h[1-6]|p|div|section|article|ul|ol)\b/);
    }
  });

  test("the closed-tab notice is one hidden element holding its heading", () => {
    expect(openDetail).toMatch(/<div id="detail-missing"[^>]*\bhidden\b[^>]*>\s*<h2>Tab closed<\/h2>/);
    expect(closedDetail).toMatch(/<div id="detail-missing" class="empty">\s*<h2>Tab closed<\/h2>/);
    expect(closedDetail).toContain("Closed by the idle timer");
    expect(closedDetail).toMatch(/<button id="detail-screen"[^>]*\bhidden\b/);
    expect(closedDetail).toMatch(/<button id="keep-open-button"[^>]*\bhidden\b/);
  });

  test("open tab shows its controls and navigation error", () => {
    expect(openDetail).toContain(">Keep open</button>");
    expect(openDetail).toContain("Page navigation failed. The tab is still open. boom<");
    expect(openDetail).toContain("Automatic idle cleanup disabled");
  });

  test("fullscreen control is inside the fullscreen tab", () => {
    expect(openDetail).toMatch(/<article id="tab-detail"[\s\S]*id="fullscreen-button"[\s\S]*<\/article>/);
    expect(read("styles.css")).toContain(".tab-detail:fullscreen .screen");
  });

  test("hidden views stay hidden despite author display rules", () => {
    expect(read("styles.css")).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  test("has the activity log panel", () => {
    expect(openDetail).toContain('id="activity-list"');
    expect(openDetail).toContain('id="activity-empty"');
    expect(openDetail).toMatch(/<li class="failed from-dashboard">/);
  });

  test("grid cards keep their classes and open/closed sections", () => {
    expect(grid).toMatch(/<section id="grid-open"[^>]*><button class="tab-card"/);
    expect(grid).toMatch(/<section id="grid-closed"[^>]*><button class="tab-card closed"/);
    expect(grid).toContain('<span class="user">user-abcde…</span>');
  });

  test("uses SVG icons, not text glyphs, for arrows and markers", () => {
    const sources = ["index.html", "styles.css", "input.ts", ...readdirSync(new URL("../../src/web-ui/components/", import.meta.url)).map((f) => `components/${f}`)];
    for (const file of sources) {
      expect(read(file)).not.toMatch(/[←→↑↓◢◣◤◥●▶◀]|&larr;|&rarr;/);
    }
    expect(openDetail).toMatch(/<button id="back-button"[^>]*><svg class="icon"/);
  });

  test("every id styled in styles.css exists in the rendered page", () => {
    const ids = [...new Set([...read("styles.css").matchAll(/#([a-z][\w-]*)/gi)].map((m) => m[1]!))]
      .filter((id) => !/^[0-9a-f]{3,8}$/i.test(id)); // skip hex colors
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
  });
});

describe("profiles", () => {
  const profileSession = { userId: "profile:p1", lastAccess: "2026-01-01T00:00:00Z", profile: "shopping", tabs: [
    { tabId: "t9", sessionKey: "default", url: "https://shop.test/", title: "Shop" },
  ] };
  const profiles = [
    { id: "p0", name: "main", kind: "named" as const, createdAt: 1, lastUsedAt: 1, userAgent: null, browserRunning: false, tabs: 0, default: true },
    { id: "p1", name: "shopping", kind: "named" as const, createdAt: 1, lastUsedAt: 1, userAgent: "Mozilla/5.0 Firefox/150.0", browserRunning: true, tabs: 1 },
    { id: "p2", name: "burner-abc123", kind: "burner" as const, createdAt: 1, lastUsedAt: 1, userAgent: null, browserRunning: false, tabs: 0 },
  ];
  const withProfiles = renderToStaticMarkup(h(GridView, {
    hidden: false,
    state: { ...state, sessions: [session, profileSession], profiles },
    open: [{ session: profileSession, tab: profileSession.tabs[0]! }],
    closed: [],
    onDeleteProfile: noop,
  }));

  test("profile tabs show their profile instead of the session id", () => {
    expect(withProfiles).toContain('<span class="profile-pill" title="Browser profile">shopping</span>');
  });

  test("lists profiles with kind, user agent, state and a delete action", () => {
    expect(withProfiles).toContain('id="profile-list"');
    expect(withProfiles).toContain('<span class="profile-kind burner">burner</span>');
    expect(withProfiles).toContain("Mozilla/5.0 Firefox/150.0");
    expect(withProfiles).toContain("1 tab · running");
    // The default "main" profile has no delete button.
    expect(withProfiles.match(/class="profile-delete"/g)).toHaveLength(2);
  });

  test("profiles are created and re-fingerprinted through a popup", () => {
    const withCreate = renderToStaticMarkup(h(GridView, { hidden: false, state: { ...state, profiles: profiles.map((p) => ({ ...p, screen: { width: 1920, height: 1080 } })) }, open: [], closed: [],
      onCreateProfile: async () => true, onRegenerateProfile: async () => true }));
    expect(withCreate).toContain('id="new-profile-button"');
    expect(withCreate).toContain('<dialog id="profile-dialog"');
    expect(withCreate).toContain('<option value="1920x1080" selected="">1920 × 1080 (default)</option>');
    expect(withCreate).toContain("1920×1080");
    expect(withCreate.match(/class="profile-action"/g)).toHaveLength(profiles.length);
  });

  test("the section is omitted when there are no profiles", () => {
    expect(grid).not.toContain('id="profile-list"');
  });
});

describe("connect your agent", () => {
  test("lives in the header with a profile picker, copy button and preview popup", () => {
    expect(header).toContain('<option value="work">work</option>');
    expect(header).toContain(">Click to copy prompt</span>");
    expect(header).toContain(">Connect your agent</span>");
    expect(header).toContain('<dialog id="agent-prompt-dialog"');
    expect(header).toContain("Your dedicated browser profile is `main`");
    expect(header).toContain("http://localhost:9377/mcp");
  });

  test("is not on the main page", () => {
    expect(grid).not.toContain("copy-agent-prompt");
  });
});

describe("theme button", () => {
  test("shows the current theme as a single icon button", () => {
    expect(header).toContain('id="theme-button"');
    expect(header).toContain('title="Theme: Auto (click for Light)"');
    expect(header).not.toContain("<select id=\"theme-select\"");
  });
});

describe("browser status", () => {
  const profile = { id: "p", name: "work", kind: "named" as const, createdAt: 1, lastUsedAt: 1, userAgent: null, browserRunning: false, tabs: 0 };

  test("sits in the summary strip", () => {
    expect(grid).toContain('id="browser-status"');
  });

  test("idle when the core answers but no browser runs (no more endless warming up)", () => {
    expect(browserStatus(null, { ...state, running: false, profiles: [profile] })).toMatchObject({ kind: "idle", value: "Idle" });
  });

  test("running when any profile browser is up", () => {
    expect(browserStatus(null, { ...state, running: false, profiles: [{ ...profile, browserRunning: true }] })).toMatchObject({ kind: "running" });
  });

  test("crashed names the profile and reason", () => {
    const crashed = browserStatus(null, { ...state, running: false, profiles: [{ ...profile, browserError: { at: 1, reason: "browser_disconnected" } }] });
    expect(crashed).toMatchObject({ kind: "crashed", value: "Crashed", label: "work" });
    expect(crashed.title).toContain("work: browser_disconnected");
    expect(browserStatus(null, { ...state, running: false, browserError: "browser_died" }).title).toContain("shared browser: browser_died");
  });

  test("offline when the core can't be reached", () => {
    expect(browserStatus("Access key required", state)).toMatchObject({ kind: "offline", label: "Access key required" });
  });
});
