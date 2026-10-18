import type { Theme } from "../theme.ts";
import { normalizeTheme } from "../theme.ts";

type Props = {
  status: string;
  online: boolean;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  authHidden: boolean;
  onAuth: () => void;
};

export function Header({ status, online, theme, onThemeChange, authHidden, onAuth }: Props) {
  return (
    <header>
      <div>
        <p className="eyebrow">BWL / LIVE</p>
        <h1>Control Room</h1>
      </div>
      <div className="status-wrap">
        <span id="status-dot" className={online ? "status-dot online" : "status-dot"}></span>
        <span id="status">{status}</span>
        <label className="theme-picker">
          <span>Theme</span>
          <select id="theme-select" aria-label="Color theme" value={theme} onChange={(event) => onThemeChange(normalizeTheme(event.target.value))}>
            <option value="auto">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <button id="auth-button" type="button" hidden={authHidden} onClick={onAuth}>Access key</button>
      </div>
    </header>
  );
}
