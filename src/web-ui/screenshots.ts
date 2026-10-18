import { authHeaders } from "./api.ts";

// Grid thumbnails are cached stills, refreshed at most this often — the
// "live feed" (fast, on every poll + after each click) only exists in the
// single-tab detail view, opened deliberately.
export const THUMB_REFRESH_MS = 10_000;

/** Latest still for a tab: a blob URL once loaded, plus the last load error (shown in place of "Loading view…"). */
export type Shot = { url?: string; error?: string };
const EMPTY: Shot = {};

const shots = new Map<string, Shot>();
const lastFetchedAt = new Map<string, number>();
const queue: Array<() => Promise<void>> = [];
const queued = new Set<string>();
let active = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeShots(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getShot(tabId: string): Shot {
  return shots.get(tabId) ?? EMPTY;
}

/** Forget a tab's cached still and release its blob URL. */
export function dropShot(tabId: string) {
  const url = shots.get(tabId)?.url;
  if (url) URL.revokeObjectURL(url);
  if (shots.delete(tabId)) notify();
}

async function loadScreenshot(userId: string, tabId: string) {
  const query = new URLSearchParams({ userId, tabId });
  const response = await fetch(`/api/screenshot?${query}`, { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`View unavailable (${response.status}). Retry or reopen the tab.`);
  const blobUrl = URL.createObjectURL(await response.blob());
  const previous = shots.get(tabId)?.url;
  if (previous) URL.revokeObjectURL(previous);
  shots.set(tabId, { url: blobUrl });
  lastFetchedAt.set(tabId, Date.now());
  notify();
}

function pump() {
  while (active < 3 && queue.length > 0) {
    const task = queue.shift()!;
    active += 1;
    void task().finally(() => {
      active -= 1;
      pump();
    });
  }
}

/**
 * Enqueue a screenshot fetch. Grid thumbnails are throttled to
 * THUMB_REFRESH_MS (cached stills); pass force for the detail view's live feed.
 */
export function queueScreenshot(userId: string, tabId: string, force = false) {
  if (document.visibilityState === "hidden") return;
  if (!force) {
    const last = lastFetchedAt.get(tabId) ?? 0;
    if (Date.now() - last < THUMB_REFRESH_MS) return;
  }
  const key = `${userId}:${tabId}`;
  if (queued.has(key)) return;
  queued.add(key);
  queue.push(async () => {
    try { await loadScreenshot(userId, tabId); }
    catch (error) {
      shots.set(tabId, { ...getShot(tabId), error: error instanceof Error ? error.message : "View disconnected. Retrying…" });
      notify();
    }
    finally { queued.delete(key); }
  });
  pump();
}
