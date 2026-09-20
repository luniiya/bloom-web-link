type Tab = { tabId: string; sessionKey: string; url: string; title: string };
type Session = { userId: string; lastAccess: string; tabs: Tab[] };
type State = { running: boolean; generatedAt: string; sessions: Session[] };

export {};

const grid = document.querySelector<HTMLElement>("#grid")!;
const empty = document.querySelector<HTMLElement>("#empty")!;
const template = document.querySelector<HTMLTemplateElement>("#tab-template")!;
const status = document.querySelector<HTMLElement>("#status")!;
const statusDot = document.querySelector<HTMLElement>("#status-dot")!;
const authButton = document.querySelector<HTMLButtonElement>("#auth-button")!;
const themeSelect = document.querySelector<HTMLSelectElement>("#theme-select")!;
let accessKey = localStorage.getItem("camofox-access-key") || "";
let refreshing = false;
const imageUrls = new Map<string, string>();
const cards = new Map<string, HTMLElement>();
const screenshotQueue: Array<() => Promise<void>> = [];
const queuedScreenshots = new Set<string>();
let activeScreenshots = 0;

const savedTheme = localStorage.getItem("camofox-theme");
const initialTheme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "auto";
document.documentElement.dataset.theme = initialTheme;
themeSelect.value = initialTheme;
themeSelect.addEventListener("change", () => {
  const theme = themeSelect.value === "light" || themeSelect.value === "dark" ? themeSelect.value : "auto";
  document.documentElement.dataset.theme = theme;
  if (theme === "auto") localStorage.removeItem("camofox-theme");
  else localStorage.setItem("camofox-theme", theme);
});

function authHeaders(json = false): HeadersInit {
  return {
    ...(accessKey ? { Authorization: `Bearer ${accessKey}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

authButton.addEventListener("click", () => {
  const next = prompt("Camofox access key (leave blank when authentication is disabled)", accessKey);
  if (next === null) return;
  accessKey = next.trim();
  if (accessKey) localStorage.setItem("camofox-access-key", accessKey);
  else localStorage.removeItem("camofox-access-key");
  void refresh();
});

async function loadScreenshot(image: HTMLImageElement, screen: HTMLButtonElement, session: Session, tab: Tab) {
  const query = new URLSearchParams({ userId: session.userId, tabId: tab.tabId });
  const response = await fetch(`/api/screenshot?${query}`, { headers: authHeaders() });
  if (!response.ok) return;
  const blobUrl = URL.createObjectURL(await response.blob());
  const previous = imageUrls.get(tab.tabId);
  if (previous) URL.revokeObjectURL(previous);
  imageUrls.set(tab.tabId, blobUrl);
  image.src = blobUrl;
  screen.classList.add("ready");
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

function queueScreenshot(image: HTMLImageElement, screen: HTMLButtonElement, session: Session, tab: Tab) {
  const key = `${session.userId}:${tab.tabId}`;
  if (queuedScreenshots.has(key)) return;
  queuedScreenshots.add(key);
  screenshotQueue.push(async () => {
    try { await loadScreenshot(image, screen, session, tab); }
    finally { queuedScreenshots.delete(key); }
  });
  pumpScreenshots();
}

function createCard(session: Session, tab: Tab): HTMLElement {
  const card = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  card.querySelector("h2")!.textContent = tab.title || "Untitled tab";
  card.querySelector<HTMLElement>(".url")!.textContent = tab.url;
  card.querySelector<HTMLElement>(".session-pill")!.textContent = tab.sessionKey;
  card.querySelector<HTMLElement>(".user")!.textContent = session.userId;
  const screen = card.querySelector<HTMLButtonElement>(".screen")!;
  const image = card.querySelector<HTMLImageElement>("img")!;
  screen.addEventListener("click", async (event) => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const bounds = image.getBoundingClientRect();
    const displayedRatio = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
    const contentWidth = image.naturalWidth * displayedRatio;
    const contentHeight = image.naturalHeight * displayedRatio;
    const offsetX = (bounds.width - contentWidth) / 2;
    const offsetY = (bounds.height - contentHeight) / 2;
    const x = (event.clientX - bounds.left - offsetX) / displayedRatio;
    const y = (event.clientY - bounds.top - offsetY) / displayedRatio;
    if (x < 0 || y < 0 || x > image.naturalWidth || y > image.naturalHeight) return;
    await fetch("/api/click", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ userId: session.userId, tabId: tab.tabId, x, y }),
    });
    setTimeout(() => queueScreenshot(image, screen, session, tab), 250);
  });
  queueScreenshot(image, screen, session, tab);
  return card;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch("/api/state", { headers: authHeaders() });
    if (response.status === 401) throw new Error("Access key required");
    if (!response.ok) throw new Error(`Dashboard unavailable (${response.status})`);
    const state = await response.json() as State;
    const tabs = state.sessions.flatMap((session) => session.tabs.map((tab) => ({ session, tab })));
    const activeKeys = new Set<string>();
    const elements = tabs.map(({ session, tab }) => {
      const key = `${session.userId}:${tab.tabId}`;
      activeKeys.add(key);
      let card = cards.get(key);
      if (!card) {
        card = createCard(session, tab);
        cards.set(key, card);
      } else {
        card.querySelector("h2")!.textContent = tab.title || "Untitled tab";
        card.querySelector<HTMLElement>(".url")!.textContent = tab.url;
        queueScreenshot(card.querySelector("img")!, card.querySelector(".screen")!, session, tab);
      }
      return card;
    });
    for (const [key, card] of cards) {
      if (!activeKeys.has(key)) {
        card.remove();
        cards.delete(key);
        const tabId = key.slice(key.lastIndexOf(":") + 1);
        const imageUrl = imageUrls.get(tabId);
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrls.delete(tabId);
      }
    }
    grid.replaceChildren(...elements);
    empty.hidden = tabs.length > 0;
    document.querySelector("#session-count")!.textContent = String(state.sessions.length);
    document.querySelector("#tab-count")!.textContent = String(tabs.length);
    document.querySelector("#updated")!.textContent = new Date(state.generatedAt).toLocaleTimeString();
    status.textContent = state.running ? "Browser online" : "Browser warming up";
    statusDot.classList.toggle("online", state.running);
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
