import fs from 'node:fs';
import path from 'node:path';

// Local recovery history. Never fetch page content during cleanup: persist only
// text already explicitly read by the user/agent, with a bounded file size.
// `limit` caps entries per user. `globalLimit` bounds entries of ad-hoc
// sessions; profile history (`profile:` users) lives until its profile is
// deleted, so a flood of throwaway agent sessions can't evict it.
export function createTabHistory(file, limit = 100, globalLimit = limit * 20) {
  let entries = [];
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(saved)) entries = trimGlobal(saved); } catch {}
  function trimGlobal(list) {
    let excess = list.filter(e => !String(e.userId).startsWith('profile:')).length - globalLimit;
    if (excess <= 0) return list;
    return list.filter(e => String(e.userId).startsWith('profile:') || excess-- <= 0);
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(entries), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  return {
    list(userId) { return entries.filter(e => userId === undefined || e.userId === userId).map(e => ({ ...e })); },
    get(userId, tabId) { return entries.findLast(e => e.userId === userId && e.tabId === tabId); },
    record(userId, tabId, tab, reason, sessionKey = 'default') {
      let url = tab.lastRequestedUrl || '';
      try { const current = tab.page?.url(); if (current && current !== 'about:blank') url = current; } catch {}
      const entry = { userId, tabId, sessionKey, url, title: tab.lastTitle || '', reason, closedAt: Date.now(), text: (tab.lastReadText || tab.lastSnapshot || '').slice(-50000) };
      entries = entries.filter(e => !(e.userId === userId && e.tabId === tabId));
      entries.push(entry);
      // Cap per user so one busy session can't evict another's history.
      const own = entries.filter(e => e.userId === userId);
      if (own.length > limit) { const drop = new Set(own.slice(0, own.length - limit)); entries = entries.filter(e => !drop.has(e)); }
      entries = trimGlobal(entries);
      save();
      return entry;
    },
    removeUser(userId) {
      const before = entries.length;
      entries = entries.filter(e => e.userId !== userId);
      if (entries.length !== before) save();
    },
  };
}
