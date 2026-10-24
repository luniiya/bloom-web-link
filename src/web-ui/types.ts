import type { Lifetime } from "./lifetime.ts";

export type Tab = { tabId: string; sessionKey: string; url: string; title: string; lifetime?: Lifetime; navigationError?: string };
export type ClosedRecord = Tab & { userId: string; closedAt: number; reason: string; profile?: string | null };
/** `profile` is set when the session belongs to a global browser profile. */
export type Session = { userId: string; lastAccess: string; tabs: Tab[]; profile?: string | null };
export type Profile = { id: string; name: string; kind: "named" | "burner"; createdAt: number; lastUsedAt: number; userAgent: string | null; browserRunning: boolean; tabs: number; default?: boolean };
export type State = { running: boolean; generatedAt: string; sessions: Session[]; closedTabs?: ClosedRecord[]; profiles?: Profile[] };
export type TabRef = { session: Session; tab: Tab };
export type ClosedEntry = TabRef & { closedAt: number; reason?: string };

/** Short, readable stand-in for a full userId/tabId — not for security, just display. */
export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}
