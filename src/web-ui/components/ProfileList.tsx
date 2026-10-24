import type { Profile } from "../types.ts";

// Global browser profiles: each has its own fingerprint, cookies and history.
// Burners are wiped by the core after a period without use.
export function ProfileList({ profiles, onDelete }: { profiles: Profile[]; onDelete?: (name: string) => void }) {
  if (profiles.length === 0) return null;
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
    </section>
  );
}
