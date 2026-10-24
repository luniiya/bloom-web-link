import { useState } from "react";
import type { Profile } from "../types.ts";
import { ProfileDialog, type ProfileDialogMode, type ProfileInput } from "./ProfileDialog.tsx";

type Props = {
  profiles: Profile[];
  onDelete?: (name: string) => void;
  /** Each resolves true on success, which closes the dialog. */
  onCreate?: (input: ProfileInput) => Promise<boolean>;
  onRegenerate?: (name: string, input: ProfileInput) => Promise<boolean>;
};

const OS_NAMES = { windows: "Windows", macos: "macOS", linux: "Linux" } as const;

// Global browser profiles: each has its own fingerprint, cookies and history.
// Burners are wiped by the core after a period without use.
export function ProfileList({ profiles, onDelete, onCreate, onRegenerate }: Props) {
  const [dialog, setDialog] = useState<ProfileDialogMode>(null);
  if (profiles.length === 0 && !onCreate) return null;
  return (
    <section className="tab-section">
      <div className="section-head">
        <h3 className="section-heading">Profiles</h3>
        {onCreate && <button id="new-profile-button" type="button" className="new-profile" onClick={() => setDialog({ kind: "create" })}><span aria-hidden="true">+</span> New profile</button>}
      </div>
      <ul id="profile-list" className="profile-list" aria-label="Browser profiles">
        {profiles.map((profile) => (
          <li key={profile.id} className="profile-row">
            <span className="profile-pill">{profile.name}</span>
            <span className={profile.kind === "burner" ? "profile-kind burner" : "profile-kind"}>{profile.kind}</span>
            <span className="profile-ua" title={profile.userAgent ?? ""}>{profile.userAgent ?? "—"}</span>
            {profile.screen && <span className="profile-screen" title="Spoofed screen and OS">{profile.screen.width}×{profile.screen.height}{profile.os ? ` · ${OS_NAMES[profile.os]}` : ""}</span>}
            <span className="profile-meta">{profile.browserRunning ? `${profile.tabs} tab${profile.tabs === 1 ? "" : "s"} · running` : `idle · used ${new Date(profile.lastUsedAt).toLocaleDateString()}`}</span>
            {onRegenerate && <button type="button" className="profile-action" title="Give this profile a new fingerprint" onClick={() => setDialog({ kind: "fingerprint", profile })}>New fingerprint</button>}
            {onDelete && !profile.default && <button type="button" className="profile-delete" onClick={() => onDelete(profile.name)}>Delete</button>}
          </li>
        ))}
      </ul>
      {(onCreate || onRegenerate) && (
        <ProfileDialog mode={dialog} onClose={() => setDialog(null)} onSubmit={(input) => {
          if (dialog?.kind === "fingerprint") return onRegenerate ? onRegenerate(dialog.profile.name, input) : Promise.resolve(false);
          return onCreate ? onCreate(input) : Promise.resolve(false);
        }} />
      )}
    </section>
  );
}
