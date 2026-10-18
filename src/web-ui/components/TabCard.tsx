import { openTab } from "../route.ts";
import { shortId, type TabRef } from "../types.ts";
import { GlobeIcon } from "./icons.tsx";
import { LOADING_TEXT, useShot } from "./useShot.ts";

// Grid cards: small, read-only. Click anywhere on a card opens its detail view.
export function TabCard({ session, tab, closed }: TabRef & { closed: boolean }) {
  const shot = useShot(tab.tabId);
  return (
    <button className={closed ? "tab-card closed" : "tab-card"} type="button" title="Open this tab" onClick={() => openTab(session.userId, tab.tabId)}>
      <div className="tab-meta">
        <div className="favicon"><GlobeIcon /></div>
        <div className="titles"><h2>{tab.title || "Untitled tab"}</h2><p className="url">{tab.url}</p></div>
      </div>
      <div className={shot.url ? "screen-thumb ready" : "screen-thumb"}>
        <img alt="Live browser tab screenshot" src={shot.url} />
        <span className="loading">{shot.error ?? LOADING_TEXT}</span>
      </div>
      <div className="tab-footer"><span className="session-pill">{tab.sessionKey}</span><span className="user">{shortId(session.userId)}</span></div>
    </button>
  );
}
