import { useEffect, useRef, useState } from "react";
import type { Profile } from "../types.ts";

export type ProfileInput = { name?: string; burner: boolean; screen: string; os?: string; locale?: string; timezone?: string };
/** "create" opens a blank form; a profile opens it to re-roll that profile's fingerprint. */
export type ProfileDialogMode = { kind: "create" } | { kind: "fingerprint"; profile: Profile } | null;

type Props = {
  mode: ProfileDialogMode;
  onClose: () => void;
  /** Resolves true on success, which closes the dialog. */
  onSubmit: (input: ProfileInput) => Promise<boolean>;
};

const SCREENS = ["1920x1080", "2560x1440", "1536x864", "1440x900", "1366x768", "3840x2160"];
export const DEFAULT_SCREEN = SCREENS[0]!;
const NAME_PATTERN = "[a-zA-Z0-9][a-zA-Z0-9_.\\-]*";
const OSES = [["", "Host"], ["windows", "Windows"], ["macos", "macOS"], ["linux", "Linux"]] as const;
const LOCALES = ["en-US", "en-GB", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR", "nl-NL", "ja-JP", "ko-KR", "zh-CN"];
const TIMEZONES: string[] = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } })();

function screenOf(profile?: Profile): string {
  return profile?.screen ? `${profile.screen.width}x${profile.screen.height}` : DEFAULT_SCREEN;
}

export function ProfileDialog({ mode, onClose, onSubmit }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [burner, setBurner] = useState(false);
  const [preset, setPreset] = useState(DEFAULT_SCREEN);
  const [custom, setCustom] = useState("");
  const [os, setOs] = useState("");
  const [locale, setLocale] = useState("");
  const [timezone, setTimezone] = useState("");
  const [busy, setBusy] = useState(false);
  const profile = mode?.kind === "fingerprint" ? mode.profile : undefined;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!mode) { if (element.open) element.close(); return; }
    const current = screenOf(profile);
    setName("");
    setBurner(false);
    setPreset(SCREENS.includes(current) ? current : "custom");
    setCustom(SCREENS.includes(current) ? "" : current);
    setOs(profile?.os ?? "");
    setLocale(profile?.locale ?? "");
    setTimezone(profile?.timezone ?? "");
    if (!element.open) element.showModal();
  }, [mode]);

  const screen = preset === "custom" ? custom.trim().toLowerCase() : preset;
  const screenValid = /^\d{3,4}x\d{3,4}$/.test(screen);
  const canSubmit = !busy && screenValid && (profile || burner || name.trim());

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    const ok = await onSubmit({ name: burner ? undefined : name.trim() || undefined, burner, screen, os: os || undefined, locale: locale.trim() || undefined, timezone: timezone.trim() || undefined });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <dialog id="profile-dialog" ref={dialog} className="prompt-dialog profile-dialog" aria-labelledby="profile-dialog-title"
      onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <form className="prompt-dialog-body" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="prompt-dialog-head">
          <div>
            <p className="eyebrow">{profile ? "New fingerprint" : "Browser profile"}</p>
            <h2 id="profile-dialog-title">{profile ? <>Profile <span className="profile-pill">{profile.name}</span></> : "New profile"}</h2>
          </div>
          <button type="button" className="prompt-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>×</button>
        </div>

        {profile ? (
          <p className="profile-dialog-note">Closes this profile's tabs and browser and gives it a new machine identity: user agent, screen, fonts and canvas/audio noise. Cookies and storage are kept.</p>
        ) : (
          <>
            <div className="profile-field">
              <span className="profile-field-label">Kind</span>
              <div className="segmented" role="radiogroup" aria-label="Profile kind">
                <button type="button" role="radio" aria-checked={!burner} onClick={() => setBurner(false)}>Named</button>
                <button type="button" role="radio" aria-checked={burner} onClick={() => setBurner(true)}>Burner</button>
              </div>
              <span className="profile-field-hint">{burner ? "Gets a generated name and is wiped 30 days after last use." : "Kept until you delete it."}</span>
            </div>
            {!burner && (
              <label className="profile-field">
                <span className="profile-field-label">Name</span>
                <input id="profile-name" className="profile-input" autoFocus placeholder="shopping" value={name} maxLength={64} pattern={NAME_PATTERN}
                  spellCheck={false} autoComplete="off" onChange={(event) => setName(event.target.value)} />
                <span className="profile-field-hint">Letters, digits, "_", "-" and ".".</span>
              </label>
            )}
          </>
        )}

        <label className="profile-field">
          <span className="profile-field-label">Screen</span>
          <select id="profile-screen" className="profile-input" value={preset} onChange={(event) => setPreset(event.target.value)}>
            {SCREENS.map((size) => <option key={size} value={size}>{size.replace("x", " × ")}{size === DEFAULT_SCREEN ? " (default)" : ""}</option>)}
            <option value="custom">Custom…</option>
          </select>
          {preset === "custom" && (
            <input className="profile-input" aria-label="Custom screen size" placeholder="1680x1050" value={custom} pattern="\d{3,4}[xX]\d{3,4}"
              spellCheck={false} onChange={(event) => setCustom(event.target.value)} />
          )}
          <span className="profile-field-hint">The window is spoofed as maximized, above the OS taskbar.</span>
        </label>

        <div className="profile-field">
          <span className="profile-field-label">Operating system</span>
          <div className="segmented" role="radiogroup" aria-label="Spoofed operating system">
            {OSES.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={os === value} onClick={() => setOs(value)}>{label}</button>)}
          </div>
          <span className="profile-field-hint">User agent, fonts and taskbar of that OS. Host matches the machine bwl runs on.</span>
        </div>

        <div className="profile-row-fields">
          <label className="profile-field">
            <span className="profile-field-label">Locale</span>
            <input id="profile-locale" className="profile-input" list="profile-locales" placeholder="auto" value={locale} spellCheck={false} autoComplete="off" onChange={(event) => setLocale(event.target.value)} />
          </label>
          <label className="profile-field">
            <span className="profile-field-label">Timezone</span>
            <input id="profile-timezone" className="profile-input" list="profile-timezones" placeholder="auto" value={timezone} spellCheck={false} autoComplete="off" onChange={(event) => setTimezone(event.target.value)} />
          </label>
        </div>
        <span className="profile-field-hint profile-field-hint-tight">Leave on auto to follow the proxy's location (or the server's BWL_LOCALE / BWL_TIMEZONE).</span>
        <datalist id="profile-locales">{LOCALES.map((value) => <option key={value} value={value} />)}</datalist>
        <datalist id="profile-timezones">{TIMEZONES.map((value) => <option key={value} value={value} />)}</datalist>

        <div className="prompt-dialog-foot profile-dialog-foot">
          <button type="button" className="profile-delete" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" className="prompt-dialog-copy" disabled={!canSubmit}>
            {busy ? "Working…" : profile ? "New fingerprint" : "Create profile"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
