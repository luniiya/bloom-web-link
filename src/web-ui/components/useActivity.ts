import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { mergeActivity, type ActivityEntry } from "../activity.ts";
import { authHeaders } from "../api.ts";

/**
 * Activity log for one tab at a time. `refresh(tabId)` switches tabs (clearing
 * the log) and appends anything new since the last entry held. The list
 * stays pinned to the bottom if it was scrolled there before an update.
 */
export function useActivity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  const tabRef = useRef("");
  const entriesRef = useRef<ActivityEntry[]>([]);
  const loadingRef = useRef(false);
  const stickRef = useRef(false);

  const commit = useCallback((next: ActivityEntry[]) => {
    const list = listRef.current;
    stickRef.current = !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    entriesRef.current = next;
    setEntries(next);
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (stickRef.current && list) list.scrollTop = list.scrollHeight;
  }, [entries]);

  const refresh = useCallback(async (tabId: string) => {
    if (tabId !== tabRef.current) {
      tabRef.current = tabId;
      commit([]);
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const since = entriesRef.current.at(-1)?.seq ?? 0;
      const query = new URLSearchParams({ tabId, since: String(since) });
      const response = await fetch(`/api/activity?${query}`, { headers: authHeaders() });
      if (!response.ok || tabId !== tabRef.current) return;
      const { entries: incoming } = await response.json() as { entries: ActivityEntry[] };
      if (incoming.length === 0) return;
      commit(mergeActivity(entriesRef.current, incoming));
    } catch {
      // Transient; the next poll retries.
    } finally {
      loadingRef.current = false;
    }
  }, [commit]);

  return { entries, listRef, refresh };
}
