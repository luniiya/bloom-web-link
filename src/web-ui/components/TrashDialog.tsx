import { useEffect, useRef, useState } from "react";
import type { Profile } from "../types.ts";
import { RestoreIcon } from "./icons.tsx";

type Props = {
  open: boolean;
  onClose: () => void;
  load: () => Promise<Profile[] | null>;
  /** Resolves true when the profile is back. */
  onRestore: (name: string) => Promise<boolean>;
};

const DAY = 24 * 60 * 60 * 1000;

function daysLeft(profile: Profile): number {
  return Math.max(0, Math.ceil(((profile.purgeAt ?? 0) - Date.now()) / DAY));
}

// Deleted profiles keep their data for 30 days. There is deliberately no
// "delete forever": the sweep erases them when the time is up.
export function TrashDialog({ open, onClose, load, onRestore }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { if (element.open) element.close(); return; }
    setProfiles(null);
    if (!element.open) element.showModal();
    void load().then(setProfiles);
  }, [open]);

  async function restore(name: string) {
    setBusy(name);
    if (await onRestore(name)) setProfiles((list) => list?.filter((p) => p.name !== name) ?? null);
    setBusy(null);
  }

  return (
    <dialog id="trash-dialog" ref={dialog} className="prompt-dialog profile-dialog" aria-labelledby="trash-dialog-title"
      onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="prompt-dialog-body">
        <div className="prompt-dialog-head">
          <div>
            <p className="eyebrow">Browser profiles</p>
            <h2 id="trash-dialog-title">Trash</h2>
          </div>
          <button type="button" className="prompt-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>×</button>
        </div>
        <p className="profile-dialog-note">Deleted profiles keep their cookies, storage and fingerprint for 30 days, then they are erased for good.</p>
        {profiles === null ? <p className="empty-inline">Loading…</p> : profiles.length === 0 ? <p id="trash-empty" className="empty-inline">The trash is empty.</p> : (
          <ul id="trash-list" className="trash-list">
            {profiles.map((profile) => (
              <li key={profile.id} className="trash-row">
                <span className="profile-pill">{profile.name}</span>
                <span className="profile-meta">{daysLeft(profile)} day{daysLeft(profile) === 1 ? "" : "s"} left</span>
                <button type="button" className="profile-action trash-restore" disabled={busy !== null} onClick={() => void restore(profile.name)}><RestoreIcon /> Restore</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
