import { lifetimeLabel, closureLabel, type Lifetime } from "./lifetime.ts";
type Tab = { tabId: string; sessionKey: string; url: string; title: string; lifetime?: Lifetime; navigationError?: string };
type ClosedRecord = Tab & { userId: string; closedAt: number; reason: string };
type Session = { userId: string; lastAccess: string; tabs: Tab[] };
type State = { running: boolean; generatedAt: string; sessions: Session[]; closedTabs?: ClosedRecord[] };
type TabRef = { session: Session; tab: Tab };

import { keyToPress, isPasteShortcut, isCopyShortcut } from "./keys.ts";
import { formatActivity, mergeActivity, type ActivityEntry } from "./activity.ts";

export {};

const gridView = document.querySelector<HTMLElement>("#grid-view")!;
const detailView = document.querySelector<HTMLElement>("#detail-view")!;
const gridOpen = document.querySelector<HTMLElement>("#grid-open")!;
const gridClosed = document.querySelector<HTMLElement>("#grid-closed")!;
const emptyOpen = document.querySelector<HTMLElement>("#empty-open")!;
const emptyClosed = document.querySelector<HTMLElement>("#empty-closed")!;
const template = document.querySelector<HTMLTemplateElement>("#tab-template")!;
const status = document.querySelector<HTMLElement>("#status")!;
const statusDot = document.querySelector<HTMLElement>("#status-dot")!;
const authButton = document.querySelector<HTMLButtonElement>("#auth-button")!;
const themeSelect = document.querySelector<HTMLSelectElement>("#theme-select")!;
const backButton = document.querySelector<HTMLButtonElement>("#back-button")!;
const detailTitle = document.querySelector<HTMLElement>("#detail-title")!;
const detailUrl = document.querySelector<HTMLElement>("#detail-url")!;
const detailSession = document.querySelector<HTMLElement>("#detail-session")!;
const detailUser = document.querySelector<HTMLElement>("#detail-user")!;
const fullscreenButton = document.querySelector<HTMLButtonElement>("#fullscreen-button")!;
const keepOpenButton = document.querySelector<HTMLButtonElement>("#keep-open-button")!;
const lifetimeStatus = document.querySelector<HTMLElement>("#lifetime-status")!;
const navigationError = document.querySelector<HTMLElement>("#navigation-error")!;
const reopenButton = document.querySelector<HTMLButtonElement>("#reopen-button")!;
const saveTranscriptButton = document.querySelector<HTMLButtonElement>("#save-transcript-button")!;
const closureReason = document.querySelector<HTMLElement>("#closure-reason")!;
const tabDetail = document.querySelector<HTMLElement>("#tab-detail")!;
const detailScreen = document.querySelector<HTMLButtonElement>("#detail-screen")!;
const detailImg = document.querySelector<HTMLImageElement>("#detail-img")!;
const detailMissing = document.querySelector<HTMLElement>("#detail-missing")!;
const activityList = document.querySelector<HTMLOListElement>("#activity-list")!;
const activityEmpty = document.querySelector<HTMLElement>("#activity-empty")!;

let accessKey = localStorage.getItem("bwl-access-key") || "";
let refreshing = false;
let latestState: State | null = null;
const imageUrls = new Map<string, string>();
const screenshotQueue: Array<() => Promise<void>> = [];
const queuedScreenshots = new Set<string>();
let activeScreenshots = 0;

// Grid thumbnails are cached stills, refreshed at most this often — the
// "live feed" (fast, on every poll + after each click) only exists in the
// single-tab detail view, opened deliberately.
const THUMB_REFRESH_MS = 10_000;
const lastFetchedAt = new Map<string, number>();

// Client-side memory of tabs that used to be open. A tab that drops out of
// /api/state moves here (keeping its last title/url/thumbnail) instead of
// just vanishing, so "Closed" has something to show. Session-local only —
// resets on page reload.
const MAX_CLOSED = 40;
type ClosedEntry = TabRef & { closedAt: number; reason?: string };
const closedTabs = new Map<string, ClosedEntry>();
let previousOpen = new Map<string, TabRef>();

const savedTheme = localStorage.getItem("bwl-theme");
const initialTheme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "auto";
document.documentElement.dataset.theme = initialTheme;
themeSelect.value = initialTheme;
themeSelect.addEventListener("change", () => {
  const theme = themeSelect.value === "light" || themeSelect.value === "dark" ? themeSelect.value : "auto";
  document.documentElement.dataset.theme = theme;
  if (theme === "auto") localStorage.removeItem("bwl-theme");
  else localStorage.setItem("bwl-theme", theme);
});

function authHeaders(json = false): HeadersInit {
  return {
    ...(accessKey ? { Authorization: `Bearer ${accessKey}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

authButton.addEventListener("click", () => {
  const next = prompt("Bloom Web Link access key (leave blank when authentication is disabled)", accessKey);
  if (next === null) return;
  accessKey = next.trim();
  if (accessKey) localStorage.setItem("bwl-access-key", accessKey);
  else localStorage.removeItem("bwl-access-key");
  void refresh();
});

/** Short, readable stand-in for a full userId/tabId — not for security, just display. */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}

// --- Routing: "" (or "#") = grid overview, "#tab/<userId>/<tabId>" = single-tab detail. ---
type Route = { kind: "grid" } | { kind: "detail"; userId: string; tabId: string };

function parseRoute(): Route {
  const match = /^#tab\/([^/]+)\/([^/]+)$/.exec(location.hash);
  if (!match) return { kind: "grid" };
  return { kind: "detail", userId: decodeURIComponent(match[1]!), tabId: decodeURIComponent(match[2]!) };
}

function openTab(userId: string, tabId: string) {
  location.hash = `tab/${encodeURIComponent(userId)}/${encodeURIComponent(tabId)}`;
}

backButton.addEventListener("click", () => {
  location.hash = "";
});

async function loadScreenshot(image: HTMLImageElement, screen: HTMLElement, userId: string, tabId: string) {
  const query = new URLSearchParams({ userId, tabId });
  const response = await fetch(`/api/screenshot?${query}`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`View unavailable (${response.status}). Retry or reopen the tab.`);
  const blobUrl = URL.createObjectURL(await response.blob());
  const previous = imageUrls.get(tabId);
  if (previous) URL.revokeObjectURL(previous);
  imageUrls.set(tabId, blobUrl);
  image.src = blobUrl;
  screen.classList.add("ready");
  screen.querySelector(".loading")!.textContent = "Loading view…";
  lastFetchedAt.set(tabId, Date.now());
}

function pumpScreenshots() {
  while (activeScreenshots < 3 && screenshotQueue.length > 0) {
    const task = screenshotQueue.shift()!;
    activeScreenshots += 1;
    void task().finally(() => {
      activeScreenshots -= 1;
      pumpScreenshots();
    });
  }
}

/**
 * Enqueue a screenshot fetch. Grid thumbnails are throttled to
 * THUMB_REFRESH_MS (cached stills); pass force for the detail view's live feed.
 */
function queueScreenshot(image: HTMLImageElement, screen: HTMLElement, userId: string, tabId: string, force = false) {
  if (document.visibilityState === "hidden") return;
  if (!force) {
    const last = lastFetchedAt.get(tabId) ?? 0;
    if (Date.now() - last < THUMB_REFRESH_MS) return;
  }
  const key = `${userId}:${tabId}`;
  if (queuedScreenshots.has(key)) return;
  queuedScreenshots.add(key);
  screenshotQueue.push(async () => {
    try { await loadScreenshot(image, screen, userId, tabId); }
    catch (error) { const loading = screen.querySelector(".loading"); if (loading) loading.textContent = error instanceof Error ? error.message : "View disconnected. Retrying…"; }
    finally { queuedScreenshots.delete(key); }
  });
  pumpScreenshots();
}

function applyCachedThumb(image: HTMLImageElement, screen: HTMLElement, tabId: string) {
  const cached = imageUrls.get(tabId);
  if (cached) {
    image.src = cached;
    screen.classList.add("ready");
  }
}

// --- Grid cards: small, read-only. Click anywhere on a card opens its detail view. ---
function createCard(session: Session, tab: Tab, closed: boolean): HTMLElement {
  const card = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  card.classList.toggle("closed", closed);
  card.querySelector("h2")!.textContent = tab.title || "Untitled tab";
  card.querySelector<HTMLElement>(".url")!.textContent = tab.url;
  card.querySelector<HTMLElement>(".session-pill")!.textContent = tab.sessionKey;
  card.querySelector<HTMLElement>(".user")!.textContent = shortId(session.userId);
  const thumb = card.querySelector<HTMLElement>(".screen-thumb")!;
  const image = card.querySelector<HTMLImageElement>("img")!;
  applyCachedThumb(image, thumb, tab.tabId);
  card.addEventListener("click", () => openTab(session.userId, tab.tabId));
  if (!closed) queueScreenshot(image, thumb, session.userId, tab.tabId);
  return card;
}

/** Move tabs that dropped out of the live state into closedTabs, keeping their last known data. */
function trackClosures(state: State) {
  for (const record of state.closedTabs || []) {
    const key = `${record.userId}:${record.tabId}`;
    closedTabs.set(key, { session: { userId: record.userId, lastAccess: new Date(record.closedAt).toISOString(), tabs: [] }, tab: record, closedAt: record.closedAt, reason: record.reason });
  }
  const openNow = new Map<string, TabRef>();
  for (const session of state.sessions) {
    for (const tab of session.tabs) openNow.set(`${session.userId}:${tab.tabId}`, { session, tab });
  }
  for (const [key, ref] of previousOpen) {
    if (!openNow.has(key) && !closedTabs.has(key)) closedTabs.set(key, { ...ref, closedAt: Date.now() });
  }
  for (const key of openNow.keys()) closedTabs.delete(key);
  if (closedTabs.size > MAX_CLOSED) {
    const overflow = [...closedTabs.entries()].sort((a, b) => a[1].closedAt - b[1].closedAt).slice(0, closedTabs.size - MAX_CLOSED);
    for (const [key, entry] of overflow) {
      closedTabs.delete(key);
      const imageUrl = imageUrls.get(entry.tab.tabId);
      if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrls.delete(entry.tab.tabId); }
    }
  }
  previousOpen = openNow;
  return openNow;
}

function renderGrid(state: State) {
  const openNow = trackClosures(state);

  const openPairs = [...openNow.values()];
  gridOpen.replaceChildren(...openPairs.map(({ session, tab }) => createCard(session, tab, false)));
  emptyOpen.hidden = openPairs.length > 0;

  const closedPairs = [...closedTabs.values()].sort((a, b) => b.closedAt - a.closedAt);
  gridClosed.replaceChildren(...closedPairs.map(({ session, tab }) => createCard(session, tab, true)));
  emptyClosed.hidden = closedPairs.length > 0;

  document.querySelector("#session-count")!.textContent = String(state.sessions.length);
  document.querySelector("#tab-count")!.textContent = String(openPairs.length);
  document.querySelector("#updated")!.textContent = new Date(state.generatedAt).toLocaleTimeString();
}

// --- Activity log: every call made against the open tab, appended as it happens. ---
let activityTabId = "";
let activityEntries: ActivityEntry[] = [];
let activityLoading = false;

function renderActivity() {
  activityEmpty.hidden = activityEntries.length > 0;
  const stickToBottom = activityList.scrollHeight - activityList.scrollTop - activityList.clientHeight < 24;
  activityList.replaceChildren(...activityEntries.map((entry) => {
    const row = formatActivity(entry);
    const item = document.createElement("li");
    item.classList.toggle("failed", row.failed);
    item.classList.toggle("from-dashboard", row.fromDashboard);
    for (const [cls, text] of [["time", row.time], ["action", row.action], ["detail", row.detail], ["meta", row.meta]]) {
      const span = document.createElement("span");
      span.className = cls!;
      span.textContent = text!;
      if (cls === "detail") span.title = text!;
      item.append(span);
    }
    return item;
  }));
  if (stickToBottom) activityList.scrollTop = activityList.scrollHeight;
}

async function refreshActivity(tabId: string) {
  if (tabId !== activityTabId) {
    activityTabId = tabId;
    activityEntries = [];
    renderActivity();
  }
  if (activityLoading) return;
  activityLoading = true;
  try {
    const since = activityEntries.at(-1)?.seq ?? 0;
    const query = new URLSearchParams({ tabId, since: String(since) });
    const response = await fetch(`/api/activity?${query}`, { headers: authHeaders() });
    if (!response.ok || tabId !== activityTabId) return;
    const { entries } = await response.json() as { entries: ActivityEntry[] };
    if (entries.length === 0) return;
    activityEntries = mergeActivity(activityEntries, entries);
    renderActivity();
  } catch {
    // Transient; the next poll retries.
  } finally {
    activityLoading = false;
  }
}

// Size the live view to the browser viewport's real aspect ratio (no letterboxing).
detailImg.addEventListener("load", () => {
  if (detailImg.naturalWidth && detailImg.naturalHeight) {
    detailScreen.style.setProperty("--screen-ratio", `${detailImg.naturalWidth} / ${detailImg.naturalHeight}`);
  }
});

// --- Detail: the single interactive view. Click-to-control only lives here. ---
let detailClickBound = false;

function renderDetail(state: State, userId: string, tabId: string) {
  void refreshActivity(tabId);
  const session = state.sessions.find((s) => s.userId === userId);
  const tab = session?.tabs.find((t) => t.tabId === tabId);
  if (!session || !tab) {
    // Closed: keep showing what it was (if this page saw it open) plus its log.
    const last = closedTabs.get(`${userId}:${tabId}`);
    detailMissing.hidden = false;
    closureReason.textContent = closureLabel(last?.reason);
    reopenButton.disabled = !last?.tab.url || !/^https?:\/\//i.test(last.tab.url);
    saveTranscriptButton.disabled = !last;
    keepOpenButton.hidden = true;
    lifetimeStatus.textContent = "";
    navigationError.hidden = true;
    detailScreen.hidden = true;
    detailTitle.textContent = last ? last.tab.title || "Untitled tab" : "";
    detailUrl.textContent = last?.tab.url ?? "";
    detailSession.textContent = last?.tab.sessionKey ?? "";
    detailUser.textContent = shortId(userId);
    return;
  }
  detailMissing.hidden = true;
  keepOpenButton.hidden = false;
  keepOpenButton.setAttribute("aria-pressed", String(!!tab.lifetime?.keepOpen));
  keepOpenButton.textContent = tab.lifetime?.keepOpen ? "Allow idle cleanup" : "Keep open";
  lifetimeStatus.textContent = lifetimeLabel(tab.lifetime);
  navigationError.hidden = !tab.navigationError;
  navigationError.textContent = tab.navigationError ? "Page navigation failed. The tab is still open. " + tab.navigationError.split("\n")[0] : "";
  detailScreen.hidden = false;
  detailTitle.textContent = tab.title || "Untitled tab";
  detailUrl.textContent = tab.url;
  detailSession.textContent = tab.sessionKey;
  detailUser.textContent = shortId(session.userId);
  queueScreenshot(detailImg, detailScreen, userId, tabId, true);

  if (!detailClickBound) {
    detailClickBound = true;
    detailScreen.addEventListener("click", async (event) => {
      const route = parseRoute();
      if (route.kind !== "detail") return;
      if (!detailImg.naturalWidth || !detailImg.naturalHeight) return;
      const bounds = detailImg.getBoundingClientRect();
      const ratio = Math.min(bounds.width / detailImg.naturalWidth, bounds.height / detailImg.naturalHeight);
      const contentWidth = detailImg.naturalWidth * ratio;
      const contentHeight = detailImg.naturalHeight * ratio;
      const offsetX = (bounds.width - contentWidth) / 2;
      const offsetY = (bounds.height - contentHeight) / 2;
      const x = (event.clientX - bounds.left - offsetX) / ratio;
      const y = (event.clientY - bounds.top - offsetY) / ratio;
      detailScreen.focus();
      if (x < 0 || y < 0 || x > detailImg.naturalWidth || y > detailImg.naturalHeight) return;
      await fetch("/api/click", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ userId: route.userId, tabId: route.tabId, x, y }),
      });
      setTimeout(() => queueScreenshot(detailImg, detailScreen, route.userId, route.tabId, true), 250);
    });
  }
}

keepOpenButton.addEventListener("click", async () => {
  const route = parseRoute(); if (route.kind !== "detail") return;
  try {
    const response = await fetch("/api/lifetime", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ userId: route.userId, tabId: route.tabId, keepOpen: keepOpenButton.getAttribute("aria-pressed") !== "true" }) });
    if (!response.ok) throw new Error("Could not change tab protection");
    await refresh();
  } catch (error) { status.textContent = String(error); }
});
reopenButton.addEventListener("click", async () => {
  const route = parseRoute(); if (route.kind !== "detail") return;
  const saved = closedTabs.get(`${route.userId}:${route.tabId}`); if (!saved) return;
  reopenButton.disabled = true;
  try {
    const response = await fetch("/api/reopen", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ userId: route.userId, sessionKey: saved.tab.sessionKey, url: saved.tab.url }), signal: AbortSignal.timeout(45000) });
    const result = await response.json() as { tabId?: string; error?: string };
    if (!response.ok || !result.tabId) throw new Error(result.error || "Could not reopen tab");
    await refresh(); openTab(route.userId, result.tabId);
  } catch (error) { closureReason.textContent = String(error); }
  finally { reopenButton.disabled = false; }
});
saveTranscriptButton.addEventListener("click", async () => {
  const route = parseRoute(); if (route.kind !== "detail") return;
  try {
    const response = await fetch(`/api/history?${new URLSearchParams({ userId: route.userId, tabId: route.tabId })}`, { headers: authHeaders() });
    if (!response.ok) throw new Error("No saved text is available for this tab");
    const saved = await response.json() as { url: string; text: string };
    const url = URL.createObjectURL(new Blob([saved.url + "\n\n" + saved.text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `bwl-${route.tabId}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { closureReason.textContent = String(error); }
});

fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === tabDetail) await document.exitFullscreen();
    else await tabDetail.requestFullscreen();
    detailScreen.focus();
  } catch {
    status.textContent = "Fullscreen is unavailable in this browser.";
  }
});
document.addEventListener("fullscreenchange", () => {
  const active = document.fullscreenElement === tabDetail;
  fullscreenButton.textContent = active ? "Exit fullscreen" : "Fullscreen";
  fullscreenButton.setAttribute("aria-pressed", String(active));
});

// --- Keyboard: while the detail screen has focus, keystrokes go to the page. ---
// Printable characters are batched briefly and typed into the page's focused
// element; everything else (Enter, arrows, Ctrl/Cmd chords) is a key press.
// A promise chain keeps text and presses in the order they were typed.
let keyboardChain: Promise<unknown> = Promise.resolve();
let pendingText = "";
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function sendKeyboard(input: { text: string } | { key: string }) {
  const route = parseRoute();
  if (route.kind !== "detail") return;
  keyboardChain = keyboardChain
    .then(() => fetch("/api/keyboard", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ userId: route.userId, tabId: route.tabId, ...input }),
    }))
    .catch(() => {})
    .then(() => queueScreenshot(detailImg, detailScreen, route.userId, route.tabId, true));
}

function flushText() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!pendingText) return;
  const text = pendingText;
  pendingText = "";
  sendKeyboard({ text });
}

detailScreen.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (isCopyShortcut(event)) {
    event.preventDefault();
    flushText();
    const route = parseRoute();
    keyboardChain = keyboardChain.then(async () => {
      if (route.kind !== "detail") return;
      const response = await fetch("/api/clipboard", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ userId: route.userId, tabId: route.tabId }),
      });
      if (!response.ok) throw new Error("Copy failed");
      const { text } = await response.json() as { text: string };
      if (text) await navigator.clipboard.writeText(text);
    }).catch(() => {
      status.textContent = "Copy blocked: allow clipboard access for this dashboard, then try again.";
    });
    return;
  }
  if (isPasteShortcut(event)) {
    // Read while this user gesture is active. The remote browser has a
    // separate clipboard; forwarding Control+v cannot paste local text.
    if (!navigator.clipboard?.readText) return; // allow native paste fallback
    event.preventDefault();
    flushText();
    const clipboard = navigator.clipboard.readText();
    const route = parseRoute();
    keyboardChain = keyboardChain.then(async () => {
      const text = await clipboard;
      if (!text || route.kind !== "detail") return;
      await fetch("/api/keyboard", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ userId: route.userId, tabId: route.tabId, text }),
      });
      queueScreenshot(detailImg, detailScreen, route.userId, route.tabId, true);
    }).catch(() => {
      status.textContent = "Paste blocked: allow clipboard access for this dashboard, then try again.";
    });
    return;
  }
  event.preventDefault();
  const chord = event.ctrlKey || event.metaKey || event.altKey;
  const key = keyToPress(event);
  if (key === null) return;
  if (!chord && event.key.length === 1) {
    pendingText += event.key;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushText, 120);
    return;
  }
  flushText();
  sendKeyboard({ key });
});
// Space/Enter would otherwise "click" the focused <button> on keyup.
detailScreen.addEventListener("keyup", (event) => event.preventDefault());
detailScreen.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  pendingText += text;
  flushText();
});

function renderRoute() {
  if (!latestState) return;
  trackClosures(latestState);
  const route = parseRoute();
  gridView.hidden = route.kind !== "grid";
  detailView.hidden = route.kind !== "detail";
  if (route.kind === "grid") renderGrid(latestState);
  else renderDetail(latestState, route.userId, route.tabId);
}

window.addEventListener("hashchange", renderRoute);

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const route = parseRoute();
    if (route.kind === "detail" && document.visibilityState !== "hidden") {
      await fetch("/api/lifetime", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ userId: route.userId, tabId: route.tabId, viewing: true }), signal: AbortSignal.timeout(5000) }).catch(() => {});
    }
    const response = await fetch("/api/state", { headers: authHeaders(), signal: AbortSignal.timeout(10000) });
    if (response.status === 401) throw new Error("Access key required");
    if (!response.ok) throw new Error(`Dashboard unavailable (${response.status})`);
    latestState = await response.json() as State;
    renderRoute();
    status.textContent = latestState.running ? "Browser online" : "Browser warming up";
    statusDot.classList.toggle("online", latestState.running);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Disconnected";
    statusDot.classList.remove("online");
  } finally {
    refreshing = false;
  }
}

async function initialize() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json() as { authRequired?: boolean };
    authButton.hidden = !config.authRequired;
  } catch {
    authButton.hidden = true;
  }
  await refresh();
  setInterval(refresh, 3_000);
}

void initialize();
