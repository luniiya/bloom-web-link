import type { Lifetime } from "./lifetime.ts";

export type Tab = { tabId: string; sessionKey: string; url: string; title: string; lifetime?: Lifetime; navigationError?: string };
export type ClosedRecord = Tab & { userId: string; closedAt: number; reason: string; profile?: string | null };
/** `profile` is set when the session belongs to a global browser profile. */
export type Session = { userId: string; lastAccess: string; tabs: Tab[]; profile?: string | null };
export type ProfileSettings = {
  gpu: { vendor: string; renderer: string }; cores: number | null; mics: number; speakers: number; webcams: number;
  voices: "auto" | "none"; doNotTrack: boolean; globalPrivacyControl: boolean; webrtc: "real" | "block";
  geoip: boolean; humanize: boolean; drift: boolean;
};
/** Choices from GET /profiles/options. */
export type ProfileOptions = { gpus: Record<string, { vendor: string; renderer: string }[]>; cores: number[]; hostOS: string };
export type Profile = { id: string; name: string; kind: "named" | "burner"; createdAt: number; lastUsedAt: number; userAgent: string | null; browserRunning: boolean; tabs: number; default?: boolean;
  screen?: { width: number; height: number } | null;
  os?: "windows" | "macos" | "linux" | null; locale?: string | null; timezone?: string | null;
  settings?: ProfileSettings;
  /** Set on trashed profiles: when they were deleted and when their data is erased. */
  deletedAt?: number; purgeAt?: number;
  /** Last unexpected stop (crash, kill, failed launch) since its last good launch. */
  browserError?: { at: number; reason: string } | null };
export type State = { running: boolean; browserError?: string | null; generatedAt: string; sessions: Session[]; closedTabs?: ClosedRecord[]; profiles?: Profile[] };
export type TabRef = { session: Session; tab: Tab };
export type ClosedEntry = TabRef & { closedAt: number; reason?: string };

/** Short, readable stand-in for a full userId/tabId — not for security, just display. */
export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}
