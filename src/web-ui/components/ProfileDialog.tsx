import { useEffect, useRef, useState } from "react";
import { authHeaders } from "../api.ts";
import type { Profile, ProfileOptions, ProfileSettings } from "../types.ts";

export type ProfileInput = { name?: string; burner: boolean; screen: string; os?: string; locale?: string; timezone?: string; settings?: Partial<ProfileSettings> | Record<string, unknown> };
/** "create" opens a blank form; a profile opens it to change that profile's settings. */
export type ProfileDialogMode = { kind: "create" } | { kind: "configure"; profile: Profile } | null;

type Props = {
  mode: ProfileDialogMode;
  onClose: () => void;
  /** Resolves true on success, which closes the dialog. */
  onSubmit: (input: ProfileInput) => Promise<boolean>;
  /** Configure only: re-roll the machine identity. */
  onNewFingerprint?: (input: ProfileInput) => Promise<boolean>;
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

/** "ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar" -> "NVIDIA GeForce GTX 980" */
function gpuLabel(renderer: string): string {
  return (/ANGLE \([^,]+, (.+?) Direct3D/.exec(renderer)?.[1] ?? renderer).replace(/, or similar$/, "");
}
const gpuKey = (gpu: { vendor: string; renderer: string }) => `${gpu.vendor}|${gpu.renderer}`;

export function ProfileDialog({ mode, onClose, onSubmit, onNewFingerprint }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [burner, setBurner] = useState(false);
  const [preset, setPreset] = useState(DEFAULT_SCREEN);
  const [custom, setCustom] = useState("");
  const [os, setOs] = useState("");
  const [locale, setLocale] = useState("");
  const [timezone, setTimezone] = useState("");
  // Only what the person changed is sent; the rest keeps its current or random default.
  const [changes, setChanges] = useState<Record<string, unknown>>({});
  const [options, setOptions] = useState<ProfileOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const profile = mode?.kind === "configure" ? mode.profile : undefined;
  const base: Partial<ProfileSettings> = profile?.settings ?? {};

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
    setChanges({});
    if (!element.open) element.showModal();
    void fetch("/api/profiles/options", { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((body) => { if (body) setOptions(body as ProfileOptions); }).catch(() => {});
  }, [mode]);

  const screen = preset === "custom" ? custom.trim().toLowerCase() : preset;
  const screenValid = /^\d{3,4}x\d{3,4}$/.test(screen);
  const canSubmit = !busy && screenValid && (profile || burner || name.trim());

  const value = <K extends keyof ProfileSettings>(key: K): ProfileSettings[K] | undefined => (key in changes ? changes[key] : base[key]) as ProfileSettings[K] | undefined;
  const set = (key: keyof ProfileSettings, next: unknown) => setChanges((all) => ({ ...all, [key]: next }));
  const effectiveOs = os || options?.hostOS || "linux";
  const gpus = options?.gpus[effectiveOs] ?? [];
  const gpu = value("gpu");

  function input(): ProfileInput {
    // A GPU picked for another OS no longer applies once the OS changes.
    const settings = { ...changes };
    if (!gpus.some((g) => gpu && gpuKey(g) === gpuKey(gpu))) delete settings.gpu;
    return {
      name: burner ? undefined : name.trim() || undefined, burner, screen, os,
      locale: profile ? locale.trim() : locale.trim() || undefined,
      timezone: profile ? timezone.trim() : timezone.trim() || undefined,
      ...(Object.keys(settings).length ? { settings } : {}),
    };
  }

  async function run(action: (data: ProfileInput) => Promise<boolean>) {
    if (!canSubmit) return;
    setBusy(true);
    const ok = await action(input());
    setBusy(false);
    if (ok) onClose();
  }

  const select = (label: string, key: keyof ProfileSettings, choices: [string, string][], parse: (raw: string) => unknown = (raw) => raw) => {
    const current = value(key);
    return (
      <label className="profile-field">
        <span className="profile-field-label">{label}</span>
        <select className="profile-input" value={current === null || current === undefined ? "" : String(current)} onChange={(event) => {
          // "Default" (create only) means send nothing, leaving the server's pick.
          if (event.target.value === "" && !["cores", "gpu"].includes(key)) setChanges(({ [key]: _dropped, ...rest }) => rest);
          else set(key, event.target.value === "" ? null : parse(event.target.value));
        }}>
          {choices.map(([raw, text]) => <option key={raw} value={raw}>{text}</option>)}
        </select>
      </label>
    );
  };
  const count = (max: number): [string, string][] => [...(profile ? [] : [["", "Default"] as [string, string]]), ...Array.from({ length: max + 1 }, (_, n): [string, string] => [String(n), String(n)])];
  const toggle = (label: string, key: keyof ProfileSettings, hint: string, fallback: boolean) => (
    <label className="profile-toggle">
      <input type="checkbox" checked={Boolean(key in changes ? changes[key] : base[key] ?? fallback)} onChange={(event) => set(key, event.target.checked)} />
      <span><strong>{label}</strong><small>{hint}</small></span>
    </label>
  );

  return (
    <dialog id="profile-dialog" ref={dialog} className="prompt-dialog profile-dialog" aria-labelledby="profile-dialog-title"
      onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <form className="prompt-dialog-body" onSubmit={(event) => { event.preventDefault(); void run(onSubmit); }}>
        <div className="prompt-dialog-head">
          <div>
            <p className="eyebrow">{profile ? "Configure" : "Browser profile"}</p>
            <h2 id="profile-dialog-title">{profile ? <>Profile <span className="profile-pill">{profile.name}</span></> : "New profile"}</h2>
          </div>
          <button type="button" className="prompt-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>×</button>
        </div>

        {!profile && (
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
            {OSES.map(([raw, label]) => <button key={raw} type="button" role="radio" aria-checked={os === raw} onClick={() => setOs(raw)}>{label}</button>)}
          </div>
          <span className="profile-field-hint">
            {profile && os !== (profile.os ?? "") ? "Changing the OS gives the profile a new fingerprint (fonts, GPU and user agent differ per OS). " : "User agent, fonts and taskbar of that OS. "}
            Host matches the machine bwl runs on.
          </span>
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
        <datalist id="profile-locales">{LOCALES.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="profile-timezones">{TIMEZONES.map((v) => <option key={v} value={v} />)}</datalist>

        <details className="profile-advanced" open={!!profile}>
          <summary>Machine details</summary>
          <label className="profile-field">
            <span className="profile-field-label">Graphics card</span>
            <select id="profile-gpu" className="profile-input" value={gpu && gpus.some((g) => gpuKey(g) === gpuKey(gpu)) ? gpuKey(gpu) : ""}
              onChange={(event) => { const found = gpus.find((g) => gpuKey(g) === event.target.value); set("gpu", found ?? null); }}>
              <option value="">{profile ? "Pick a different one…" : "Random for this OS"}</option>
              {gpus.map((g) => <option key={gpuKey(g)} value={gpuKey(g)}>{gpuLabel(g.renderer)}</option>)}
            </select>
            <span className="profile-field-hint">Real pairs seen on that OS. Software renderers are left out because they give a VM away.</span>
          </label>
          <div className="profile-row-fields profile-row-even">
            {select("CPU cores", "cores", [["", profile ? "Auto" : "Fits the GPU"], ...(options?.cores ?? [2, 4, 6, 8, 10, 12, 16]).map((n): [string, string] => [String(n), String(n)])], Number)}
            {select("Voices", "voices", [["auto", "Those of the OS"], ["none", "None"]])}
          </div>
          <div className="profile-row-fields profile-row-even profile-row-three">
            {select("Microphones", "mics", count(4), Number)}
            {select("Speakers", "speakers", count(4), Number)}
            {select("Webcams", "webcams", count(2), Number)}
          </div>
          {select("WebRTC", "webrtc", [["real", "Real (shows the public IP)"], ["block", "Blocked"]])}
          {toggle("Follow the IP's location", "geoip", "Timezone and geolocation come from the public IP.", true)}
          {toggle("Move the mouse like a person", "humanize", "Curved cursor paths instead of straight jumps.", true)}
          {toggle("Let it change over time", "drift", "A headset or webcam comes and goes, and the window is sometimes not maximized.", true)}
          {toggle("Do Not Track", "doNotTrack", "Few people turn it on, so it stands out.", false)}
          {toggle("Global Privacy Control", "globalPrivacyControl", "Sent by privacy browsers only.", false)}
        </details>

        <div className="prompt-dialog-foot profile-dialog-foot">
          <button type="button" className="profile-delete" onClick={() => dialog.current?.close()}>Cancel</button>
          {profile && onNewFingerprint && (
            <button type="button" className="profile-action profile-regenerate" disabled={!canSubmit} title="Give this profile a new machine identity: user agent, fonts, canvas and audio noise. Cookies and storage are kept." onClick={() => void run(onNewFingerprint)}>New fingerprint</button>
          )}
          <button type="submit" className="prompt-dialog-copy" disabled={!canSubmit}>
            {busy ? "Working…" : profile ? "Save" : "Create profile"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
