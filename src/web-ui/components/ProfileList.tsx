import { useState } from "react";
import type { Profile } from "../types.ts";

type Props = {
  profiles: Profile[];
  onDelete?: (name: string) => void;
  /** Resolves true once the profile exists, so the field can be cleared. */
  onCreate?: (name: string) => Promise<boolean>;
};

// Global browser profiles: each has its own fingerprint, cookies and history.
// Burners are wiped by the core after a period without use.
export function ProfileList({ profiles, onDelete, onCreate }: Props) {
  const [name, setName] = useState("");
  if (profiles.length === 0 && !onCreate) return null;
  return (
    <section className="tab-section">
      <h3 className="section-heading">Profiles</h3>
      <ul id="profile-list" className="profile-list" aria-label="Browser profiles">
        {profiles.map((profile) => (
          <li key={profile.id} className="profile-row">
            <span className="profile-pill">{profile.name}</span>
            <span className={profile.kind === "burner" ? "profile-kind burner" : "profile-kind"}>{profile.kind}</span>
            <span className="profile-ua" title={profile.userAgent ?? ""}>{profile.userAgent ?? "—"}</span>
            <span className="profile-meta">{profile.browserRunning ? `${profile.tabs} tab${profile.tabs === 1 ? "" : "s"} · running` : `idle · used ${new Date(profile.lastUsedAt).toLocaleDateString()}`}</span>
            {onDelete && !profile.default && <button type="button" className="profile-delete" onClick={() => onDelete(profile.name)}>Delete</button>}
          </li>
        ))}
      </ul>
      {onCreate && (
        <form id="profile-create" className="profile-create" onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed) void onCreate(trimmed).then((ok) => { if (ok) setName(""); });
        }}>
          <input aria-label="New profile name" placeholder="new-profile-name" value={name} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]*" spellCheck={false} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="profile-delete" disabled={!name.trim()}>Create profile</button>
        </form>
      )}
    </section>
  );
}
