import type { ClosedEntry, State, TabRef } from "../types.ts";
import { ProfileList } from "./ProfileList.tsx";
import type { ProfileInput } from "./ProfileDialog.tsx";
import { TabCard } from "./TabCard.tsx";

type Props = {
  hidden: boolean;
  /** Why the core can't be reached; null when it answers. */
  connError?: string | null;
  state: State | null;
  open: TabRef[];
  closed: ClosedEntry[];
  onDeleteProfile?: (name: string) => void;
  onCreateProfile?: (input: ProfileInput) => Promise<boolean>;
  onRegenerateProfile?: (name: string, input: ProfileInput) => Promise<boolean>;
};

export function GridView({ hidden, connError = null, state, open, closed, onDeleteProfile, onCreateProfile, onRegenerateProfile }: Props) {
  return (
    <section id="grid-view" hidden={hidden}>
      <section className="summary" aria-live="polite">
        <div><strong id="session-count">{state ? state.sessions.length : 0}</strong><span>sessions</span></div>
        <div><strong id="tab-count">{open.length}</strong><span>live tabs</span></div>
        <div><strong id="updated">{state ? new Date(state.generatedAt).toLocaleTimeString() : "—"}</strong><span>last sync</span></div>
        <BrowserStatus connError={connError} state={state} />
      </section>

      <section className="tab-section">
        <h3 className="section-heading">Open</h3>
        <p id="empty-open" className="empty-inline" hidden={!state || open.length > 0}>No open tabs. Connect an MCP client to <code>/mcp</code> — new agent tabs will appear here automatically.</p>
        <section id="grid-open" className="grid" aria-label="Open browser tabs">
          {open.map(({ session, tab }) => <TabCard key={`${session.userId}:${tab.tabId}`} session={session} tab={tab} closed={false} />)}
        </section>
      </section>

      <ProfileList profiles={state?.profiles ?? []} onDelete={onDeleteProfile} onCreate={onCreateProfile} onRegenerate={onRegenerateProfile} />

      <section className="tab-section">
        <h3 className="section-heading">Closed</h3>
        <p id="empty-closed" className="empty-inline" hidden={!state || closed.length > 0}>No closed tabs yet.</p>
        <section id="grid-closed" className="grid grid-closed" aria-label="Recently closed tabs">
          {closed.map(({ session, tab }) => <TabCard key={`${session.userId}:${tab.tabId}`} session={session} tab={tab} closed />)}
        </section>
      </section>
    </section>
  );
}

// Browsers start lazily: each profile launches its own when an agent opens a
// tab in it and stops after idling, so "idle" is the normal resting state.
export function browserStatus(connError: string | null, state: State | null): { kind: string; value: string; label: string; title: string } {
  if (connError) return { kind: "offline", value: "Offline", label: connError, title: connError };
  if (!state) return { kind: "offline", value: "—", label: "browser", title: "" };
  const crashed = (state.profiles ?? []).filter((p) => p.browserError);
  if (crashed.length || state.browserError) {
    const what = crashed.map((p) => `${p.name}: ${p.browserError!.reason}`).concat(state.browserError ? [`shared browser: ${state.browserError}`] : []);
    return { kind: "crashed", value: "Crashed", label: crashed.length === 1 ? crashed[0]!.name : "browser", title: `Browser stopped unexpectedly. ${what.join("; ")}. It relaunches on the next tab.` };
  }
  const running = state.running || (state.profiles ?? []).some((p) => p.browserRunning);
  return running
    ? { kind: "running", value: "Running", label: "browser", title: "A browser is running" }
    : { kind: "idle", value: "Idle", label: "browser", title: "No browser running. One starts when an agent opens a tab." };
}

function BrowserStatus({ connError, state }: { connError: string | null; state: State | null }) {
  const { kind, value, label, title } = browserStatus(connError, state);
  return (
    <div id="browser-status" className={`summary-status ${kind}`} title={title}>
      <strong><span className="status-dot" aria-hidden="true"></span>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
