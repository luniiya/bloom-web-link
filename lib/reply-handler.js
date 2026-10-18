import crypto from 'node:crypto';
import { observeReply, updateReplyStream } from './reply-watch.js';

export function createReplyWaitHandler({ sessions, normalizeUserId, findTab, tabNotFoundResponse, handleRouteError }) {
  return async (req, res) => {
    let tab, session, cancel, disconnected = false, ownsWait = false;
    try {
      const { userId, messageSelector, typingSelector, cursor, waitForTyping = true, timeout = 45000, quietMs = 700 } = req.body;
      if (!userId || typeof messageSelector !== 'string' || !messageSelector.trim() || (typingSelector !== undefined && typeof typingSelector !== 'string')) return res.status(400).json({ error: 'userId and messageSelector are required; typingSelector must be a CSS selector' });
      if (typeof waitForTyping !== 'boolean' || !Number.isFinite(timeout) || timeout < 0 || timeout > 55000 || !Number.isFinite(quietMs) || quietMs < 0 || quietMs > 5000 || (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 0))) return res.status(400).json({ error: 'timeout must be 0–55000ms, quietMs 0–5000ms, and cursor a nonnegative integer' });
      session = sessions.get(normalizeUserId(userId));
      const found = session && findTab(session, req.params.tabId);
      if (!found) return tabNotFoundResponse(res, req.params.tabId);
      tab = found.tabState;
      if (tab.pendingReplyWaits) return res.status(409).json({ error: 'A reply wait is already active for this tab', code: 'reply_wait_active' });
      ownsWait = true;
      tab.pendingReplyWaits = 1; tab.toolCalls++; session.lastAccess = Date.now();
      const waitId = crypto.randomUUID();
      const options = { messageSelector, typingSelector, waitForTyping, quietMs, waitId };
      cancel = () => { disconnected = true; tab.page.evaluate(id => window.__bwlReplyWaits?.get(id)?.(), waitId).catch(() => {}); };
      res.once('close', cancel);
      const key = JSON.stringify([messageSelector, typingSelector || '']);
      tab.replyStreams ||= new Map();
      // Bound user-supplied selector variants and event history per tab.
      if (!tab.replyStreams.has(key) && tab.replyStreams.size >= 8) tab.replyStreams.delete(tab.replyStreams.keys().next().value);
      const stream = tab.replyStreams.get(key) || { cursor: 0, events: [], initialized: false };
      tab.replyStreams.set(key, stream);
      const initial = await boundedEvaluation(tab.page.evaluate(observeReply, { ...options, timeoutMs: 0 }), 5000);
      updateReplyStream(stream, initial.messages);
      if (cursor !== undefined && cursor > stream.cursor) return res.status(400).json({ error: 'Cursor is ahead of this message stream; reset with timeout: 0', code: 'invalid_cursor' });
      const since = cursor ?? stream.cursor;
      let sample = initial;
      let reason = stream.events.some(e => e.cursor > since) ? 'reply' : 'baseline';
      if (timeout > 0 && !disconnected && (reason !== 'reply' || (waitForTyping && initial.typing === 'typing'))) {
        sample = await boundedEvaluation(tab.page.evaluate(observeReply, { ...options, baseline: initial.messages, hasPending: reason === 'reply', timeoutMs: timeout }), timeout + 1000);
        reason = sample.reason;
        updateReplyStream(stream, sample.messages);
      }
      const events = stream.events.filter(e => e.cursor > since);
      tab.lastReadText = sample.messages.join('\n').slice(-50000);
      if (!disconnected) res.json({ ok: true, reason, messages: events, cursor: stream.cursor, typing: sample.typing, timedOut: reason === 'timeout', historyTruncated: !!stream.events.length && since < stream.events[0].cursor - 1 });
    } catch (err) {
      if (tab) tab.page.evaluate(() => { for (const cancel of window.__bwlReplyWaits?.values() || []) cancel(); }).catch(() => {});
      if (!disconnected && /invalid selector|not a valid selector|SyntaxError/i.test(err.message)) res.status(400).json({ error: 'Invalid messageSelector or typingSelector', code: 'invalid_selector' });
      else if (!disconnected) handleRouteError(err, req, res);
    } finally {
      if (cancel) res.removeListener('close', cancel);
      if (tab && ownsWait) { tab.pendingReplyWaits = 0; tab.lastActivityAt = Date.now(); }
      if (session) session.lastAccess = Date.now();
    }
  };
}

async function boundedEvaluation(promise, timeout) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Reply watcher timed out waiting for the browser')), timeout); })]);
  } finally { clearTimeout(timer); }
}
