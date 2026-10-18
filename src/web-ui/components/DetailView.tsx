import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { ActivityEntry } from "../activity.ts";
import { authHeaders } from "../api.ts";
import { handleScreenClick, handleScreenKeyDown, handleScreenPaste } from "../input.ts";
import { closureLabel, lifetimeLabel } from "../lifetime.ts";
import { openTab, showGrid } from "../route.ts";
import { shortId, type ClosedEntry, type State } from "../types.ts";
import { ActivityPanel } from "./ActivityPanel.tsx";
import { BackIcon, GlobeIcon } from "./icons.tsx";
import { LOADING_TEXT, useShot } from "./useShot.ts";

type Props = {
  userId: string;
  tabId: string;
  state: State;
  /** Last known data for this tab if it is no longer open. */
  last?: ClosedEntry;
  activity: ActivityEntry[];
  activityListRef?: RefObject<HTMLOListElement | null>;
  onStatus: (message: string) => void;
  refresh: () => Promise<void>;
};

// Detail: the single interactive view. Click-to-control only lives here.
export function DetailView({ userId, tabId, state, last, activity, activityListRef, onStatus, refresh }: Props) {
  const tabDetail = useRef<HTMLElement>(null);
  const detailScreen = useRef<HTMLButtonElement>(null);
  const detailImg = useRef<HTMLImageElement>(null);
  const shot = useShot(tabId);
  const [screenRatio, setScreenRatio] = useState<string>();
  const [fullscreen, setFullscreen] = useState(false);
  const [reopening, setReopening] = useState(false);
  // An error from reopen/save replaces the closure reason until the next poll.
  const [closureNote, setClosureNote] = useState<{ state: State; text: string } | null>(null);

  useEffect(() => {
    const onChange = () => setFullscreen(!!tabDetail.current && document.fullscreenElement === tabDetail.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const session = state.sessions.find((s) => s.userId === userId);
  const tab = session?.tabs.find((t) => t.tabId === tabId);
  const isOpen = !!session && !!tab;

  const note = (text: string) => setClosureNote({ state, text });

  async function toggleKeepOpen() {
    try {
      const response = await fetch("/api/lifetime", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ userId, tabId, keepOpen: !tab?.lifetime?.keepOpen }) });
      if (!response.ok) throw new Error("Could not change tab protection");
      await refresh();
    } catch (error) { onStatus(String(error)); }
  }

  async function toggleFullscreen() {
    const element = tabDetail.current;
    if (!element) return;
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else await element.requestFullscreen();
      detailScreen.current?.focus();
    } catch {
      onStatus("Fullscreen is unavailable in this browser.");
    }
  }

  async function reopen() {
    if (!last) return;
    setReopening(true);
    try {
      const response = await fetch("/api/reopen", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ userId, sessionKey: last.tab.sessionKey, url: last.tab.url }), signal: AbortSignal.timeout(45000) });
      const result = await response.json() as { tabId?: string; error?: string };
      if (!response.ok || !result.tabId) throw new Error(result.error || "Could not reopen tab");
      await refresh(); openTab(userId, result.tabId);
    } catch (error) { note(String(error)); }
    finally { setReopening(false); }
  }

  async function saveTranscript() {
    try {
      const response = await fetch(`/api/history?${new URLSearchParams({ userId, tabId })}`, { headers: authHeaders() });
      if (!response.ok) throw new Error("No saved text is available for this tab");
      const saved = await response.json() as { url: string; text: string };
      const url = URL.createObjectURL(new Blob([saved.url + "\n\n" + saved.text], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `bwl-${tabId}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { note(String(error)); }
  }

  const shown = isOpen ? tab : last?.tab;
  const title = isOpen ? tab.title || "Untitled tab" : last ? last.tab.title || "Untitled tab" : "";
  const keepOpen = !!tab?.lifetime?.keepOpen;
  const canReopen = !!last?.tab.url && /^https?:\/\//i.test(last.tab.url);
  const screenStyle = screenRatio ? ({ "--screen-ratio": screenRatio } as CSSProperties) : undefined;

  return (
    <>
      <button id="back-button" type="button" className="back-button" onClick={showGrid}><BackIcon />All tabs</button>
      <div className="detail-layout">
        <div className="detail-main">
          <article id="tab-detail" className="tab-detail" ref={tabDetail}>
            <div className="tab-meta">
              <div className="favicon"><GlobeIcon /></div>
              <div className="titles"><h2 id="detail-title">{title}</h2><p className="url" id="detail-url">{shown?.url ?? ""}</p></div>
              <span className="session-pill" id="detail-session">{shown?.sessionKey ?? ""}</span>
              <button id="keep-open-button" type="button" aria-pressed={keepOpen} hidden={!isOpen} onClick={toggleKeepOpen}>{keepOpen ? "Allow idle cleanup" : "Keep open"}</button>
              <button id="fullscreen-button" type="button" aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
            </div>
            <p id="lifetime-status" role="status">{isOpen ? lifetimeLabel(tab.lifetime) : ""}</p>
            <p id="navigation-error" role="alert" hidden={!isOpen || !tab.navigationError}>
              {isOpen && tab.navigationError ? "Page navigation failed. The tab is still open. " + tab.navigationError.split("\n")[0] : ""}
            </p>
            <button
              id="detail-screen"
              ref={detailScreen}
              className={shot.url ? "screen ready" : "screen"}
              type="button"
              title="Click to interact; keystrokes go to the page while focused"
              hidden={!isOpen}
              style={screenStyle}
              onClick={(event) => { if (detailImg.current && detailScreen.current) void handleScreenClick(event.nativeEvent, detailImg.current, detailScreen.current); }}
              onKeyDown={(event) => handleScreenKeyDown(event.nativeEvent, onStatus)}
              // Space/Enter would otherwise "click" the focused <button> on keyup.
              onKeyUp={(event) => event.preventDefault()}
              onPaste={(event) => handleScreenPaste(event.nativeEvent)}
            >
              <img
                id="detail-img"
                ref={detailImg}
                alt="Live browser tab screenshot"
                src={shot.url}
                // Size the live view to the browser viewport's real aspect ratio (no letterboxing).
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth && image.naturalHeight) setScreenRatio(`${image.naturalWidth} / ${image.naturalHeight}`);
                }}
              />
              <span className="loading">{shot.error ?? LOADING_TEXT}</span>
            </button>
            <div className="tab-footer"><span className="user" id="detail-user">{shortId(userId)}</span><span className="hint" id="detail-hint">click the page to interact, then type</span></div>
          </article>
          <div id="detail-missing" className="empty" hidden={isOpen}>
            <h2>Tab closed</h2>
            <p id="closure-reason">{closureNote?.state === state ? closureNote.text : closureLabel(last?.reason)}</p>
            <p>Reopening may restore a conversation if the website still keeps it active.</p>
            <button id="reopen-button" type="button" disabled={reopening || !canReopen} onClick={reopen}>Reopen saved URL</button>
            <button id="save-transcript-button" type="button" disabled={!last} onClick={saveTranscript}>Save last read text</button>
          </div>
        </div>
        <ActivityPanel entries={activity} listRef={activityListRef} />
      </div>
    </>
  );
}
