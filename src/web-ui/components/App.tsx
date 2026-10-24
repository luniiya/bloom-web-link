import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders, getAccessKey, setAccessKey } from "../api.ts";
import { ClosureTracker } from "../closures.ts";
import { parseRoute, type Route } from "../route.ts";
import { dropShot, queueScreenshot } from "../screenshots.ts";
import { applyTheme, savedTheme, type Theme } from "../theme.ts";
import type { ClosedEntry, State, TabRef } from "../types.ts";
import { DetailView } from "./DetailView.tsx";
import { GridView } from "./GridView.tsx";
import type { ConnectInfo } from "./AgentPrompt.tsx";
import type { ProfileInput } from "./ProfileDialog.tsx";
import { Header } from "./Header.tsx";
import { useActivity } from "./useActivity.ts";

/** One successful poll of the core, with open/closed tabs already worked out. */
type View = { state: State; open: TabRef[]; closed: ClosedEntry[] };

const POLL_MS = 3_000;

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [view, setView] = useState<View | null>(null);
  // Connection problem, shown in the summary strip; null once the core answers.
  const [connError, setConnError] = useState<string | null>("Connecting…");
  // One-off messages (profile created, fullscreen unavailable, ...), shown as a toast.
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const showNotice = useCallback((text: string) => setNotice({ id: Date.now(), text }), []);
  const [theme, setTheme] = useState<Theme>(() => savedTheme());
  const [authHidden, setAuthHidden] = useState(false);
  const [connect, setConnect] = useState<ConnectInfo | null>(null);
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
      setConnError(null);
    } catch (error) {
      setConnError(error instanceof Error ? error.message : "Disconnected");
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
        const config = await response.json() as { authRequired?: boolean; mcpUrl?: string };
        setAuthHidden(!config.authRequired);
        setConnect({ authRequired: !!config.authRequired, mcpUrl: config.mcpUrl || `http://${location.hostname}:9377/mcp` });
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

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  function changeTheme(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  async function deleteProfile(name: string) {
    if (!confirm(`Delete profile "${name}"? Its tabs close and its fingerprint, cookies and history are erased.`)) return;
    const response = await fetch("/api/profiles/delete", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ profile: name }) }).catch(() => null);
    showNotice(response?.ok ? `Deleted profile ${name}` : `Could not delete profile ${name}`);
    void refresh();
  }

  async function createProfile(input: ProfileInput): Promise<boolean> {
    const response = await fetch("/api/profiles/create", { method: "POST", headers: authHeaders(true), body: JSON.stringify(input) }).catch(() => null);
    const body = await response?.json().catch(() => null) as { name?: string; error?: string } | null;
    const name = body?.name ?? input.name ?? "burner";
    showNotice(response?.ok ? `Created profile ${name}` : `Could not create profile${input.name ? ` ${input.name}` : ""}${body?.error ? `: ${body.error}` : ""}`);
    void refresh();
    return !!response?.ok;
  }

  async function regenerateProfile(name: string, { screen, os, locale, timezone }: ProfileInput): Promise<boolean> {
    const response = await fetch("/api/profiles/fingerprint", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ profile: name, screen, os, locale, timezone }) }).catch(() => null);
    const body = await response?.json().catch(() => null) as { error?: string } | null;
    showNotice(response?.ok ? `New fingerprint for ${name}` : `Could not change ${name}'s fingerprint${body?.error ? `: ${body.error}` : ""}`);
    void refresh();
    return !!response?.ok;
  }

  function askForKey() {
    const next = prompt("Bloom Web Link access key (leave blank when authentication is disabled)", getAccessKey());
    if (next === null) return;
    setAccessKey(next);
    void refresh();
  }

  return (
    <>
      <Header theme={theme} onThemeChange={changeTheme} authHidden={authHidden} onAuth={askForKey} connect={connect} profiles={(view?.state.profiles ?? []).map((p) => p.name)} />
      <main>
        <GridView hidden={shown.kind !== "grid"} connError={connError} state={view?.state ?? null} open={view?.open ?? []} closed={view?.closed ?? []} onDeleteProfile={(name) => void deleteProfile(name)} onCreateProfile={createProfile} onRegenerateProfile={regenerateProfile} />
        <section id="detail-view" hidden={shown.kind !== "detail"}>
          {view && shown.kind === "detail" && (
            <DetailView
              userId={shown.userId}
              tabId={shown.tabId}
              state={view.state}
              last={tracker.current.closed.get(detailKey)}
              activity={activity.entries}
              activityListRef={activity.listRef}
              onStatus={showNotice}
              refresh={refresh}
            />
          )}
        </section>
      </main>
      {notice && <div key={notice.id} className="toast" role="status">{notice.text}</div>}
    </>
  );
}
