import fs from 'node:fs';
import path from 'node:path';

// Local recovery history. Never fetch page content during cleanup: persist only
// text already explicitly read by the user/agent, with a bounded file size.
export function createTabHistory(file, limit = 100) {
  let entries = [];
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(saved)) entries = saved.slice(-limit); } catch {}
  return {
    list(userId) { return entries.filter(e => userId === undefined || e.userId === userId).map(e => ({ ...e })); },
    get(userId, tabId) { return entries.findLast(e => e.userId === userId && e.tabId === tabId); },
    record(userId, tabId, tab, reason, sessionKey = 'default') {
      let url = tab.lastRequestedUrl || '';
      try { const current = tab.page?.url(); if (current && current !== 'about:blank') url = current; } catch {}
      const entry = { userId, tabId, sessionKey, url, title: tab.lastTitle || '', reason, closedAt: Date.now(), text: (tab.lastReadText || tab.lastSnapshot || '').slice(-50000) };
      entries = entries.filter(e => !(e.userId === userId && e.tabId === tabId));
      entries.push(entry); entries = entries.slice(-limit);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = file + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(entries), { mode: 0o600 });
      fs.renameSync(temp, file);
      return entry;
    },
  };
}
