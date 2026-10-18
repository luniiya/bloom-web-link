export type Lifetime = { keepOpen: boolean; protected: boolean; expiresAt: number | null; idleTimeoutMs: number };
export function lifetimeLabel(lifetime?: Lifetime, now = Date.now()): string {
  if (!lifetime) return "";
  if (lifetime.keepOpen) return "Kept open until you close it";
  if (lifetime.protected) return "Protected while viewing or waiting for a reply";
  if (lifetime.expiresAt === null) return "Automatic idle cleanup disabled";
  const seconds = Math.max(0, Math.ceil((lifetime.expiresAt - now) / 1000));
  return seconds <= 60 ? `Closes in ${seconds}s — choose Keep open to prevent this` : `Idle cleanup in ${Math.ceil(seconds / 60)} min`;
}
export function closureLabel(reason = "unknown"): string {
  const reasons: Record<string, string> = {
    idle_timeout: "Closed by the idle timer", session_timeout: "Session expired after inactivity",
    tab_recycled: "Closed to make room for another tab", user_closed: "Closed by request",
    pressure_cleanup: "Closed to free memory", memory_pressure: "Session closed to free memory",
    create_failed: "Closed after opening failed", consecutive_timeouts: "Closed after repeated action timeouts",
  };
  if (reason.startsWith("browser_restart")) return "Closed during a browser restart";
  if (reason.startsWith("nav_failure")) return "Closed during navigation recovery";
  return reasons[reason] || `Tab closed (${reason.replaceAll("_", " ")})`;
}
