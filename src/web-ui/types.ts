import type { Lifetime } from "./lifetime.ts";

export type Tab = { tabId: string; sessionKey: string; url: string; title: string; lifetime?: Lifetime; navigationError?: string };
export type ClosedRecord = Tab & { userId: string; closedAt: number; reason: string };
export type Session = { userId: string; lastAccess: string; tabs: Tab[] };
export type State = { running: boolean; generatedAt: string; sessions: Session[]; closedTabs?: ClosedRecord[] };
export type TabRef = { session: Session; tab: Tab };
export type ClosedEntry = TabRef & { closedAt: number; reason?: string };

/** Short, readable stand-in for a full userId/tabId — not for security, just display. */
export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}
