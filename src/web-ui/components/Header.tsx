import type { Theme } from "../theme.ts";
import { AgentPrompt, type ConnectInfo } from "./AgentPrompt.tsx";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons.tsx";

type Props = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  authHidden: boolean;
  onAuth: () => void;
  /** From /api/config; the connect control appears once it is known. */
  connect?: ConnectInfo | null;
  profiles?: string[];
};

const THEMES = {
  auto: { next: "light", label: "Auto", Icon: MonitorIcon },
  light: { next: "dark", label: "Light", Icon: SunIcon },
  dark: { next: "auto", label: "Dark", Icon: MoonIcon },
} as const;

export function Header({ theme, onThemeChange, authHidden, onAuth, connect, profiles = [] }: Props) {
  const { next, label, Icon } = THEMES[theme];
  return (
    <header>
      <div>
        <p className="eyebrow">BWL / LIVE</p>
        <h1>Control Room</h1>
      </div>
      <div className="status-wrap">
        {connect && <AgentPrompt profiles={profiles} mcpUrl={connect.mcpUrl} authRequired={connect.authRequired} />}
        <button id="theme-button" type="button" className="icon-button" title={`Theme: ${label} (click for ${THEMES[next].label})`}
          aria-label={`Theme: ${label}. Switch to ${THEMES[next].label}`} onClick={() => onThemeChange(next)}>
          {/* Keyed so the icon replays its entrance animation on every switch. */}
          <span key={theme} className="theme-icon"><Icon /></span>
        </button>
        <button id="auth-button" type="button" hidden={authHidden} onClick={onAuth}>Access key</button>
      </div>
    </header>
  );
}
