// Per-tab log of the calls made against each tab, for the dashboard's
// "what is the agent doing" view. In-memory only; bounded both per tab and
// in the number of tabs remembered (closed tabs keep their log until evicted).

const DETAIL_MAX = 120;

/** Header the dashboard sets on its own calls so they're labelled (or skipped). */
export const SOURCE_HEADER = 'x-bwl-source';

function truncate(value, max = DETAIL_MAX) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function target(body) {
  if (body?.ref) return body.ref;
  if (body?.selector) return truncate(body.selector, 60);
  const c = body?.coordinates;
  if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return `(${Math.round(c.x)}, ${Math.round(c.y)})`;
  return '';
}

/**
 * Tab id + action name for a tab-scoped request, or null for anything else.
 * `POST /tabs` (create) carries no id in the path; pass the id from the response.
 */
export function parseTabRequest(method, path, createdTabId) {
  if (method === 'POST' && path === '/tabs') return createdTabId ? { tabId: createdTabId, action: 'create_tab' } : null;
  const match = /^\/tabs\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
  if (!match || match[1] === 'group') return null;
  const tabId = decodeURIComponent(match[1]);
  if (!match[2]) return method === 'DELETE' ? { tabId, action: 'close_tab' } : null;
  return { tabId, action: match[2].replace(/-/g, '_') };
}

/** One-line, human-readable summary of a call's arguments. */
export function summarizeCall(action, body = {}, query = {}) {
  switch (action) {
    case 'create_tab':
    case 'navigate':
      return truncate(body.url || body.macro && `${body.macro} ${body.query || ''}` || '');
    case 'click':
    case 'element_state':
      return target(body);
    case 'type':
      return truncate(`${target(body)} ${JSON.stringify(body.text ?? '')}${body.pressEnter || body.submit ? ' ⏎' : ''}`.trim());
    case 'press':
      return truncate(body.key ?? '');
    case 'select':
      return truncate(`${target(body)} ${JSON.stringify(body.value ?? body.label ?? '')}`.trim());
    case 'scroll':
      return truncate([body.direction, body.amount].filter((v) => v !== undefined).join(' '));
    case 'wait':
      return truncate(body.selector || body.text || body.url || body.state || '');
    case 'evaluate':
      return truncate(body.expression ?? body.script ?? '');
    case 'mouse':
      return truncate([body.action, target(body)].filter(Boolean).join(' '));
    case 'batch':
      return Array.isArray(body.actions) ? `${body.actions.length} actions` : '';
    case 'snapshot':
      return query.offset ? `offset ${query.offset}` : '';
    default:
      return '';
  }
}

export function createActivityLog({ maxEntriesPerTab = 200, maxTabs = 100 } = {}) {
  const tabs = new Map(); // tabId -> entries[], insertion order = least recently used first
  let seq = 0;

  function record(tabId, entry) {
    let entries = tabs.get(tabId);
    if (entries) tabs.delete(tabId); // re-insert to mark as recently used
    else entries = [];
    tabs.set(tabId, entries);
    const full = { seq: ++seq, ts: new Date().toISOString(), ...entry };
    entries.push(full);
    if (entries.length > maxEntriesPerTab) entries.splice(0, entries.length - maxEntriesPerTab);
    while (tabs.size > maxTabs) tabs.delete(tabs.keys().next().value);
    return full;
  }

  /** Entries for a tab, oldest first; `since` returns only entries with a larger seq. */
  function list(tabId, since = 0) {
    return (tabs.get(tabId) || []).filter((entry) => entry.seq > since);
  }

  return { record, list, get size() { return tabs.size; } };
}
