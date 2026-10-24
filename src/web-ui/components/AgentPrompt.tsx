import { useRef, useState, type PointerEvent } from "react";
import { buildAgentPrompt } from "../agent-prompt.ts";
import { CheckIcon, EyeIcon, UserIcon } from "./icons.tsx";

export type ConnectInfo = { mcpUrl: string; authRequired: boolean };
type Props = ConnectInfo & { profiles: string[] };
type CopyState = "idle" | "copied" | "failed";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // navigator.clipboard needs a secure context; plain http on a LAN IP isn't one.
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

// Header control: copies a ready-to-paste prompt that tells an agent how to
// connect to bwl and which profile is its own. Any agent may still use other
// profiles when it has a reason.
export function AgentPrompt({ profiles, mcpUrl, authRequired }: Props) {
  const names = profiles.length ? profiles : ["main"];
  const [chosen, setChosen] = useState("main");
  const profile = names.includes(chosen) ? chosen : names[0]!;
  const [copy, setCopy] = useState<CopyState>("idle");
  const [ripple, setRipple] = useState<{ key: number; x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prompt = buildAgentPrompt({ mcpUrl, profile, authRequired, profiles: names });

  async function copyPrompt() {
    setCopy(await copyText(prompt) ? "copied" : "failed");
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopy("idle"), 1800);
  }

  function startRipple(event: PointerEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setRipple({ key: event.timeStamp, x: event.clientX - box.left, y: event.clientY - box.top });
  }

  return (
    <div className="connect-agent">
      <label className="connect-profile" title="Browser profile the agent will use">
        <UserIcon />
        <select id="agent-profile-select" aria-label="Agent's browser profile" value={profile} onChange={(event) => setChosen(event.target.value)}>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <button id="copy-agent-prompt" type="button" className="connect-button" data-state={copy}
        aria-label={`Connect your agent: copy the setup prompt for the ${profile} profile`} onPointerDown={startRipple} onClick={() => void copyPrompt()}>
        {ripple && <span key={ripple.key} className="connect-ripple" style={{ left: ripple.x, top: ripple.y }} onAnimationEnd={() => setRipple(null)} />}
        {/* All labels share one grid cell, so the button keeps the widest one's size. */}
        <span className="connect-labels" aria-live="polite">
          <span data-label="idle">Connect your agent</span>
          <span data-label="hover" aria-hidden="true">Click to copy prompt</span>
          <span data-label="copied"><CheckIcon />Copied!</span>
          <span data-label="failed">Copy failed</span>
        </span>
      </button>
      <button id="agent-prompt-preview-button" type="button" className="connect-preview" title="Preview prompt" aria-label="Preview agent prompt" onClick={() => dialog.current?.showModal()}>
        <EyeIcon />
      </button>
      <dialog id="agent-prompt-dialog" ref={dialog} className="prompt-dialog" aria-labelledby="agent-prompt-title"
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="prompt-dialog-body">
          <div className="prompt-dialog-head">
            <div>
              <p className="eyebrow">Agent prompt</p>
              <h2 id="agent-prompt-title">Profile <span className="profile-pill">{profile}</span></h2>
            </div>
            <button type="button" className="prompt-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>×</button>
          </div>
          <pre id="agent-prompt-preview" className="agent-prompt-preview">{prompt}</pre>
          <div className="prompt-dialog-foot">
            <span className="prompt-dialog-url">{mcpUrl}</span>
            <button type="button" className="prompt-dialog-copy" data-state={copy} onClick={() => void copyPrompt()}>
              <span className="connect-labels">
                <span data-label="idle">Copy prompt</span>
                <span data-label="copied"><CheckIcon />Copied!</span>
                <span data-label="failed">Copy failed</span>
              </span>
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
