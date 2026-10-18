import type { ClosedEntry, State, TabRef } from "./types.ts";

// Client-side memory of tabs that used to be open. A tab that drops out of
// /api/state moves here (keeping its last title/url/thumbnail) instead of
// just vanishing, so "Closed" has something to show. Session-local only —
// resets on page reload.
export const MAX_CLOSED = 40;

export class ClosureTracker {
  readonly closed = new Map<string, ClosedEntry>();
  private previousOpen = new Map<string, TabRef>();

  constructor(private readonly onEvict: (tabId: string) => void = () => {}) {}

  /** Move tabs that dropped out of the live state into `closed`, keeping their last known data. Returns the open tabs. */
  track(state: State): Map<string, TabRef> {
    for (const record of state.closedTabs || []) {
      const key = `${record.userId}:${record.tabId}`;
      this.closed.set(key, { session: { userId: record.userId, lastAccess: new Date(record.closedAt).toISOString(), tabs: [] }, tab: record, closedAt: record.closedAt, reason: record.reason });
    }
    const openNow = new Map<string, TabRef>();
    for (const session of state.sessions) {
      for (const tab of session.tabs) openNow.set(`${session.userId}:${tab.tabId}`, { session, tab });
    }
    for (const [key, ref] of this.previousOpen) {
      if (!openNow.has(key) && !this.closed.has(key)) this.closed.set(key, { ...ref, closedAt: Date.now() });
    }
    for (const key of openNow.keys()) this.closed.delete(key);
    if (this.closed.size > MAX_CLOSED) {
      const overflow = [...this.closed.entries()].sort((a, b) => a[1].closedAt - b[1].closedAt).slice(0, this.closed.size - MAX_CLOSED);
      for (const [key, entry] of overflow) {
        this.closed.delete(key);
        this.onEvict(entry.tab.tabId);
      }
    }
    this.previousOpen = openNow;
    return openNow;
  }

  /** Most recently closed first. */
  sorted(): ClosedEntry[] {
    return [...this.closed.values()].sort((a, b) => b.closedAt - a.closedAt);
  }
}
