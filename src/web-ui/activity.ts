export type ActivityEntry = {
  seq: number;
  ts: string;
  action: string;
  detail: string;
  status: number;
  ms: number;
  source: "agent" | "dashboard";
};

export type ActivityRow = { time: string; action: string; detail: string; meta: string; failed: boolean; fromDashboard: boolean };

/** Display fields for one log line. `time` uses the viewer's locale, 24h with seconds. */
export function formatActivity(entry: ActivityEntry): ActivityRow {
  const failed = entry.status >= 400;
  const duration = entry.ms >= 1000 ? `${(entry.ms / 1000).toFixed(1)}s` : `${entry.ms}ms`;
  return {
    time: new Date(entry.ts).toLocaleTimeString([], { hour12: false }),
    action: entry.action,
    detail: entry.detail,
    meta: failed ? `${entry.status} · ${duration}` : duration,
    failed,
    fromDashboard: entry.source === "dashboard",
  };
}

/** Append newly fetched entries, ignoring any already held, keeping at most `max` (newest). */
export function mergeActivity(current: ActivityEntry[], incoming: ActivityEntry[], max = 500): ActivityEntry[] {
  const last = current.at(-1)?.seq ?? 0;
  const merged = current.concat(incoming.filter((entry) => entry.seq > last));
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}
