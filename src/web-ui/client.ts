type Tab = { tabId: string; sessionKey: string; url: string; title: string };
type Session = { userId: string; lastAccess: string; tabs: Tab[] };
type State = { running: boolean; generatedAt: string; sessions: Session[] };
type TabRef = { session: Session; tab: Tab };

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
const detailScreen = document.querySelector<HTMLButtonElement>("#detail-screen")!;
const detailImg = document.querySelector<HTMLImageElement>("#detail-img")!;
const detailMissing = document.querySelector<HTMLElement>("#detail-missing")!;

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
type ClosedEntry = TabRef & { closedAt: number };
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
  const response = await fetch(`/api/screenshot?${query}`, { headers: authHeaders() });
  if (!response.ok) return;
  const blobUrl = URL.createObjectURL(await response.blob());
  const previous = imageUrls.get(tabId);
  if (previous) URL.revokeObjectURL(previous);
  imageUrls.set(tabId, blobUrl);
  image.src = blobUrl;
  screen.classList.add("ready");
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
  if (!force) {
    const last = lastFetchedAt.get(tabId) ?? 0;
    if (Date.now() - last < THUMB_REFRESH_MS) return;
  }
  const key = `${userId}:${tabId}`;
  if (queuedScreenshots.has(key)) return;
  queuedScreenshots.add(key);
  screenshotQueue.push(async () => {
    try { await loadScreenshot(image, screen, userId, tabId); }
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
  const openNow = new Map<string, TabRef>();
  for (const session of state.sessions) {
    for (const tab of session.tabs) openNow.set(`${session.userId}:${tab.tabId}`, { session, tab });
  }
  for (const [key, ref] of previousOpen) {
    if (!openNow.has(key)) closedTabs.set(key, { ...ref, closedAt: Date.now() });
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

// --- Detail: the single interactive view. Click-to-control only lives here. ---
let detailClickBound = false;

function renderDetail(state: State, userId: string, tabId: string) {
  const session = state.sessions.find((s) => s.userId === userId);
  const tab = session?.tabs.find((t) => t.tabId === tabId);
  if (!session || !tab) {
    detailMissing.hidden = false;
    detailScreen.hidden = true;
    detailTitle.textContent = "";
    detailUrl.textContent = "";
    detailSession.textContent = "";
    detailUser.textContent = "";
    return;
  }
  detailMissing.hidden = true;
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

function renderRoute() {
  if (!latestState) return;
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
    const response = await fetch("/api/state", { headers: authHeaders() });
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
