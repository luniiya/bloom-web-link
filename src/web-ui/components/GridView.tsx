import type { ClosedEntry, State, TabRef } from "../types.ts";
import { TabCard } from "./TabCard.tsx";

type Props = {
  hidden: boolean;
  state: State | null;
  open: TabRef[];
  closed: ClosedEntry[];
};

export function GridView({ hidden, state, open, closed }: Props) {
  return (
    <section id="grid-view" hidden={hidden}>
      <section className="summary" aria-live="polite">
        <div><strong id="session-count">{state ? state.sessions.length : 0}</strong><span>sessions</span></div>
        <div><strong id="tab-count">{open.length}</strong><span>live tabs</span></div>
        <div><strong id="updated">{state ? new Date(state.generatedAt).toLocaleTimeString() : "—"}</strong><span>last sync</span></div>
      </section>

      <section className="tab-section">
        <h3 className="section-heading">Open</h3>
        <p id="empty-open" className="empty-inline" hidden={!state || open.length > 0}>No open tabs. Connect an MCP client to <code>/mcp</code> — new agent tabs will appear here automatically.</p>
        <section id="grid-open" className="grid" aria-label="Open browser tabs">
          {open.map(({ session, tab }) => <TabCard key={`${session.userId}:${tab.tabId}`} session={session} tab={tab} closed={false} />)}
        </section>
      </section>

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
