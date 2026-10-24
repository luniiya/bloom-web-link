import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders, getAccessKey, setAccessKey } from "../api.ts";
import { ClosureTracker } from "../closures.ts";
import { parseRoute, type Route } from "../route.ts";
import { dropShot, queueScreenshot } from "../screenshots.ts";
import { applyTheme, savedTheme, type Theme } from "../theme.ts";
import type { ClosedEntry, State, TabRef } from "../types.ts";
import { DetailView } from "./DetailView.tsx";
import { GridView } from "./GridView.tsx";
import { Header } from "./Header.tsx";
import { useActivity } from "./useActivity.ts";

/** One successful poll of the core, with open/closed tabs already worked out. */
type View = { state: State; open: TabRef[]; closed: ClosedEntry[] };

const POLL_MS = 3_000;

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState("Connecting…");
  const [online, setOnline] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => savedTheme());
  const [authHidden, setAuthHidden] = useState(false);
  const tracker = useRef<ClosureTracker>(null);
  tracker.current ??= new ClosureTracker(dropShot);
  const refreshing = useRef(false);
  const activity = useActivity();

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const current = parseRoute();
      if (current.kind === "detail" && document.visibilityState !== "hidden") {
        // Viewing lease: keeps the tab from idle cleanup while someone watches it.
        await fetch("/api/lifetime", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ userId: current.userId, tabId: current.tabId, viewing: true }), signal: AbortSignal.timeout(5000) }).catch(() => {});
      }
      const response = await fetch("/api/state", { headers: authHeaders(), signal: AbortSignal.timeout(10000) });
      if (response.status === 401) throw new Error("Access key required");
      if (!response.ok) throw new Error(`Dashboard unavailable (${response.status})`);
      const state = await response.json() as State;
      const open = tracker.current!.track(state);
      setView({ state, open: [...open.values()], closed: tracker.current!.sorted() });
      setStatus(state.running ? "Browser online" : "Browser warming up");
      setOnline(state.running);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Disconnected");
      setOnline(false);
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/config");
        const config = await response.json() as { authRequired?: boolean };
        setAuthHidden(!config.authRequired);
      } catch {
        setAuthHidden(true);
      }
      await refresh();
      if (!cancelled) timer = setInterval(refresh, POLL_MS);
    })();
    return () => { cancelled = true; clearInterval(timer); };
  }, [refresh]);

  // Until the first state arrives the grid shows, whatever the hash says.
  const shown: Route = view ? route : { kind: "grid" };
  const detailKey = shown.kind === "detail" ? `${shown.userId}:${shown.tabId}` : "";

  // Grid: refresh (throttled) thumbnails of open tabs on every poll.
  useEffect(() => {
    if (!view || shown.kind !== "grid") return;
    for (const { session, tab } of view.open) queueScreenshot(session.userId, tab.tabId);
  }, [view, shown.kind]);

  // Detail: activity log plus the live feed, on every poll and on navigation.
  useEffect(() => {
    if (!view || shown.kind !== "detail") return;
    void activity.refresh(shown.tabId);
    const tab = view.state.sessions.find((s) => s.userId === shown.userId)?.tabs.find((t) => t.tabId === shown.tabId);
    if (tab) queueScreenshot(shown.userId, shown.tabId, true);
  }, [view, detailKey]);

  function changeTheme(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  async function deleteProfile(name: string) {
    if (!confirm(`Delete profile "${name}"? Its tabs close and its fingerprint, cookies and history are erased.`)) return;
    const response = await fetch("/api/profiles/delete", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ profile: name }) }).catch(() => null);
    setStatus(response?.ok ? `Deleted profile ${name}` : `Could not delete profile ${name}`);
    void refresh();
  }

  function askForKey() {
    const next = prompt("Bloom Web Link access key (leave blank when authentication is disabled)", getAccessKey());
    if (next === null) return;
    setAccessKey(next);
    void refresh();
  }

  return (
    <>
      <Header status={status} online={online} theme={theme} onThemeChange={changeTheme} authHidden={authHidden} onAuth={askForKey} />
      <main>
        <GridView hidden={shown.kind !== "grid"} state={view?.state ?? null} open={view?.open ?? []} closed={view?.closed ?? []} onDeleteProfile={(name) => void deleteProfile(name)} />
        <section id="detail-view" hidden={shown.kind !== "detail"}>
          {view && shown.kind === "detail" && (
            <DetailView
              userId={shown.userId}
              tabId={shown.tabId}
              state={view.state}
              last={tracker.current.closed.get(detailKey)}
              activity={activity.entries}
              activityListRef={activity.listRef}
              onStatus={setStatus}
              refresh={refresh}
            />
          )}
        </section>
      </main>
    </>
  );
}
