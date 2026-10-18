import type { RefObject } from "react";
import { formatActivity, type ActivityEntry } from "../activity.ts";

type Props = { entries: ActivityEntry[]; listRef?: RefObject<HTMLOListElement | null> };

// Activity log: every call made against the open tab, appended as it happens.
export function ActivityPanel({ entries, listRef }: Props) {
  return (
    <aside className="activity" aria-label="Agent activity for this tab">
      <h3 className="section-heading">Activity</h3>
      <p id="activity-empty" className="activity-empty" hidden={entries.length > 0}>No calls yet.</p>
      <ol id="activity-list" className="activity-list" ref={listRef}>
        {entries.map((entry) => {
          const row = formatActivity(entry);
          const className = [row.failed && "failed", row.fromDashboard && "from-dashboard"].filter(Boolean).join(" ") || undefined;
          return (
            <li key={entry.seq} className={className}>
              <span className="time">{row.time}</span>
              <span className="action">{row.action}</span>
              <span className="detail" title={row.detail}>{row.detail}</span>
              <span className="meta">{row.meta}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
