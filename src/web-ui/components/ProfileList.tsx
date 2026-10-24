import { useState } from "react";
import type { Profile } from "../types.ts";
import { ProfileDialog, type ProfileDialogMode, type ProfileInput } from "./ProfileDialog.tsx";
import { TrashDialog } from "./TrashDialog.tsx";
import { BanIcon, SettingsIcon, TrashIcon } from "./icons.tsx";

type Props = {
  profiles: Profile[];
  /** Moves the profile to the trash. */
  onDelete?: (name: string) => void;
  /** Each resolves true on success, which closes the dialog. */
  onCreate?: (input: ProfileInput) => Promise<boolean>;
  onConfigure?: (name: string, input: ProfileInput) => Promise<boolean>;
  onRegenerate?: (name: string, input: ProfileInput) => Promise<boolean>;
  loadTrash?: () => Promise<Profile[] | null>;
  onRestore?: (name: string) => Promise<boolean>;
};

const OS_NAMES = { windows: "Windows", macos: "macOS", linux: "Linux" } as const;

// Global browser profiles: each has its own fingerprint, cookies and history.
// Burners are wiped by the core after a period without use.
export function ProfileList({ profiles, onDelete, onCreate, onConfigure, onRegenerate, loadTrash, onRestore }: Props) {
  const [dialog, setDialog] = useState<ProfileDialogMode>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  if (profiles.length === 0 && !onCreate) return null;
  return (
    <section className="tab-section">
      <div className="section-head">
        <h3 className="section-heading">Profiles</h3>
        <div className="section-actions">
          {loadTrash && onRestore && <button id="show-trash-button" type="button" className="new-profile show-trash" onClick={() => setTrashOpen(true)}><TrashIcon /> Show trash</button>}
          {onCreate && <button id="new-profile-button" type="button" className="new-profile" onClick={() => setDialog({ kind: "create" })}><span aria-hidden="true">+</span> New profile</button>}
        </div>
      </div>
      <ul id="profile-list" className="profile-list" aria-label="Browser profiles">
        {profiles.map((profile) => (
          <li key={profile.id} className="profile-row">
            <span className="profile-pill">{profile.name}</span>
            <span className={profile.kind === "burner" ? "profile-kind burner" : "profile-kind"}>{profile.kind}</span>
            <span className="profile-ua" title={profile.userAgent ?? ""}>{profile.userAgent ?? "—"}</span>
            {profile.screen && <span className="profile-screen" title="Spoofed screen and OS">{profile.screen.width}×{profile.screen.height}{profile.os ? ` · ${OS_NAMES[profile.os]}` : ""}</span>}
            <span className="profile-meta">{profile.browserRunning ? `${profile.tabs} tab${profile.tabs === 1 ? "" : "s"} · running` : `idle · used ${new Date(profile.lastUsedAt).toLocaleDateString()}`}</span>
            {onConfigure && <button type="button" className="profile-action profile-configure" aria-label={`Configure ${profile.name}`} title="Configure" onClick={() => setDialog({ kind: "configure", profile })}><SettingsIcon /></button>}
            {onDelete && (profile.default
              ? <button type="button" className="profile-trash" disabled aria-label={`${profile.name} can't be deleted`} title="The default profile can't be deleted"><span className="trash-rest"><TrashIcon /></span><span className="trash-deny"><BanIcon /></span></button>
              : <button type="button" className="profile-trash" aria-label={`Move ${profile.name} to the trash`} title="Move to trash" onClick={() => onDelete(profile.name)}><TrashIcon /></button>)}
          </li>
        ))}
      </ul>
      {(onCreate || onConfigure) && (
        <ProfileDialog mode={dialog} onClose={() => setDialog(null)}
          onSubmit={(input) => {
            if (dialog?.kind === "configure") return onConfigure ? onConfigure(dialog.profile.name, input) : Promise.resolve(false);
            return onCreate ? onCreate(input) : Promise.resolve(false);
          }}
          onNewFingerprint={dialog?.kind === "configure" && onRegenerate ? (input) => onRegenerate(dialog.profile.name, input) : undefined} />
      )}
      {loadTrash && onRestore && <TrashDialog open={trashOpen} onClose={() => setTrashOpen(false)} load={loadTrash} onRestore={onRestore} />}
    </section>
  );
}
