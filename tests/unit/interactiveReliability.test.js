import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tabProtected, sessionProtected, tabLifetime, shouldRecoverSession } from '../../lib/tab-lifetime.js';
import { createTabHistory } from '../../lib/tab-history.js';
import { observeReply, updateReplyStream } from '../../lib/reply-watch.js';

const sessionOf = tab => ({ tabGroups: new Map([['chat', new Map([['tab', tab]])]]) });
describe('interactive tab lifetime', () => {
  test('local zero disables tab cleanup, including a completely idle tab', () => {
    const tab = { toolCalls: 0, _activityCalls: 0, lastActivityAt: 1 };
    expect(tabLifetime(tab, 0, 3600000).expiresAt).toBeNull();
  });
  test.each([
    { creating: true }, { keepOpen: true }, { viewedUntil: 600001 }, { pendingReplyWaits: 1 },
  ])('an active chat survives both tab and session idle cleanup: %j', protection => {
    const tab = { toolCalls: 0, _activityCalls: 0, lastActivityAt: 1, ...protection };
    expect(tabLifetime(tab, 300000, 600000).expiresAt).toBeNull();
    expect(sessionProtected(sessionOf(tab), 600000)).toBe(true);
  });
  test('an expired viewing lease allows deliberate cleanup again', () => {
    const tab = { viewedUntil: 1000, toolCalls: 1, _activityCalls: 1, lastActivityAt: 1000 };
    expect(tabLifetime(tab, 300000, 500000).expiresAt).toBe(301000);
    expect(sessionProtected(sessionOf(tab), 500000)).toBe(false);
  });
  test('active and queued actions are protected', () => {
    expect(tabProtected({}, 1, { active: true })).toBe(true);
    expect(tabProtected({}, 1, { queue: [{}] })).toBe(true);
  });
  test('tool activity renews the tab lifetime', () => {
    const tab = { toolCalls: 2, _activityCalls: 1, lastActivityAt: 1 };
    expect(tabLifetime(tab, 300000, 600000).expiresAt).toBe(900000);
  });
  test('navigation failures do not destroy unproxied or protected sessions', () => {
    expect(shouldRecoverSession(false, sessionOf({}), 1)).toBe(false);
    expect(shouldRecoverSession(true, sessionOf({ keepOpen: true }), 1)).toBe(false);
    expect(shouldRecoverSession(true, sessionOf({}), 1)).toBe(true);
  });
});

describe('closed tab recovery history', () => {
  let folder;
  beforeEach(() => { folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bwl-history-')); });
  afterEach(() => { fs.rmSync(folder, { recursive: true, force: true }); });
  test('persists closure cause, saved URL and already-read text across restarts', () => {
    const file = path.join(folder, 'history.json');
    createTabHistory(file).record('u', 't', { page: { url: () => 'about:blank' }, lastRequestedUrl: 'https://example.test/chat', lastReadText: 'confirmation' }, 'idle_timeout');
    expect(createTabHistory(file).get('u', 't')).toMatchObject({ url: 'https://example.test/chat', text: 'confirmation', reason: 'idle_timeout' });
    expect(createTabHistory(file).get('other-user', 't')).toBeUndefined();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
  test('bounds storage and never fetches page content during cleanup', () => {
    const h = createTabHistory(path.join(folder, 'history.json'), 2);
    for (let i = 0; i < 3; i++) h.record('u', String(i), { lastReadText: 'x'.repeat(60000) }, 'user_closed');
    expect(h.list()).toHaveLength(2);
    expect(h.get('u', '2').text.length).toBe(50000);
  });
});

describe('reply cursor streams', () => {
  const stream = () => ({ cursor: 0, events: [], initialized: false });
  test('baseline is not sent back, new messages are returned once', () => {
    const s = stream(); updateReplyStream(s, ['old']);
    expect(s.events).toEqual([]);
    updateReplyStream(s, ['old', 'hello']); updateReplyStream(s, ['old', 'hello']);
    expect(s.events).toEqual([{ cursor: 1, text: 'hello' }]);
  });
  test('preserves repeated identical messages and handles trimmed chat logs', () => {
    const s = stream(); updateReplyStream(s, ['a', 'b']);
    updateReplyStream(s, ['b', 'c']); updateReplyStream(s, ['b', 'c', 'c']);
    expect(s.events.map(e => e.text)).toEqual(['c', 'c']);
  });
  test('a streaming edit returns the updated tail without the full transcript', () => {
    const s = stream(); updateReplyStream(s, ['old', 'par']);
    updateReplyStream(s, ['old', 'partial completed']);
    expect(s.events.map(e => e.text)).toEqual(['partial completed']);
  });
});

describe('reply MutationObserver', () => {
  let messages, typing, mutation, globals;
  beforeEach(() => {
    jest.useFakeTimers(); messages = ['old']; typing = false;
    globals = Object.fromEntries(['window', 'document', 'MutationObserver', 'getComputedStyle'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    const makeElement = text => ({ innerText: text, getClientRects: () => [1] });
    Object.defineProperties(globalThis, {
      window: { value: new EventTarget(), configurable: true },
      document: { value: { documentElement: {}, querySelectorAll: selector => selector === '.messages' ? messages.map(makeElement) : typing ? [makeElement('typing')] : [] }, configurable: true },
      getComputedStyle: { value: () => ({ visibility: 'visible' }), configurable: true },
      MutationObserver: { value: class { constructor(fn) { mutation = fn; } observe() {} disconnect() {} }, configurable: true },
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    for (const [key, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const options = () => ({ messageSelector: '.messages', typingSelector: '.typing', baseline: ['old'], timeoutMs: 5000, quietMs: 100, waitId: 'w' });
  test('waits through typing then settles the final message', async () => {
    const p = observeReply(options());
    messages.push('par'); typing = true; mutation(); jest.advanceTimersByTime(200);
    messages[1] = 'complete'; typing = false; mutation(); jest.advanceTimersByTime(100);
    expect(await p).toMatchObject({ reason: 'reply', messages: ['old', 'complete'], typing: 'not_typing' });
    expect(window.__bwlReplyWaits.size).toBe(0);
  });
  test('reports timeout and unknown typing without a configured indicator', async () => {
    const p = observeReply({ ...options(), typingSelector: undefined });
    jest.advanceTimersByTime(5000);
    expect(await p).toMatchObject({ reason: 'timeout', typing: 'unknown' });
  });
  test('supports cancellation and removes observers and timers', async () => {
    const p = observeReply(options()); window.__bwlReplyWaits.get('w')();
    expect(await p).toMatchObject({ reason: 'cancelled' });
    expect(jest.getTimerCount()).toBe(0);
  });
  test('pending messages from between calls resolve when typing stops', async () => {
    typing = true;
    const p = observeReply({ ...options(), hasPending: true });
    typing = false; mutation(); jest.advanceTimersByTime(100);
    expect(await p).toMatchObject({ reason: 'reply' });
  });
});

describe('retiring the browser after final idle-session cleanup', () => {
  test('closes the empty runtime after context cleanup completes', async () => {
    const { finishIdleSession } = await import('../../lib/tab-lifetime.js');
    const order = [];
    await finishIdleSession(async () => { order.push('context'); }, () => true, async () => { order.push('browser'); });
    expect(order).toEqual(['context', 'browser']);
  });
  test('a new session or pending creation prevents browser retirement', async () => {
    const { finishIdleSession } = await import('../../lib/tab-lifetime.js');
    let busy = false; const retire = jest.fn();
    await finishIdleSession(async () => { busy = true; }, () => !busy, retire);
    expect(retire).not.toHaveBeenCalled();
  });
});
