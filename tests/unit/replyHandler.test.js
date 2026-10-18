import { describe, test, expect, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { createReplyWaitHandler } from '../../lib/reply-handler.js';

function fixture(evaluate) {
  const tab = { toolCalls: 0, pendingReplyWaits: 0, page: { evaluate } };
  const session = { lastAccess: 0 };
  const res = new EventEmitter(); res.statusCode = 200;
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { res.body = value; return res; };
  const handler = createReplyWaitHandler({ sessions: new Map([['u', session]]), normalizeUserId: x => x, findTab: () => ({ tabState: tab }), tabNotFoundResponse: r => r.status(404).json({}), handleRouteError: (e, _, r) => r.status(500).json({ error: e.message }) });
  const req = { body: { userId: 'u', messageSelector: '.incoming', timeout: 0 }, params: { tabId: 't' } };
  return { tab, session, res, handler, req };
}
describe('reply wait route', () => {
  test('a rejected concurrent wait does not remove the first wait’s protection', async () => {
    const f = fixture(jest.fn()); f.tab.pendingReplyWaits = 1;
    await f.handler(f.req, f.res);
    expect(f.res.statusCode).toBe(409); expect(f.tab.pendingReplyWaits).toBe(1);
    expect(f.tab.page.evaluate).not.toHaveBeenCalled();
  });
  test('baseline then cursor delivers a reply arriving between calls exactly once', async () => {
    let messages = ['old'];
    const f = fixture(async () => ({ messages, typing: 'unknown' }));
    await f.handler(f.req, f.res);
    expect(f.res.body).toMatchObject({ messages: [], cursor: 0 });
    f.req.body.cursor = 0; messages = ['old', 'new'];
    await f.handler(f.req, f.res);
    expect(f.res.body).toMatchObject({ messages: [{ cursor: 1, text: 'new' }], cursor: 1 });
    f.req.body.cursor = 1; await f.handler(f.req, f.res);
    expect(f.res.body.messages).toEqual([]); expect(f.tab.pendingReplyWaits).toBe(0);
  });
  test('disconnect cancels the browser watcher and releases protection', async () => {
    let resolveWait; const calls = [];
    const f = fixture(async (_, options) => {
      calls.push(options);
      if (options?.timeoutMs === 0) return { messages: ['old'], typing: 'unknown' };
      if (options?.timeoutMs) return new Promise(resolve => { resolveWait = resolve; });
      resolveWait({ messages: ['old'], typing: 'unknown', reason: 'cancelled' });
    });
    f.req.body.timeout = 5000;
    const pending = f.handler(f.req, f.res);
    while (!resolveWait) await new Promise(resolve => setImmediate(resolve));
    expect(f.tab.pendingReplyWaits).toBe(1);
    f.res.emit('close'); await pending;
    expect(f.tab.pendingReplyWaits).toBe(0); expect(f.res.body).toBeUndefined();
    expect(calls).toHaveLength(3);
  });
  test('normal timeout is a result, not a destructive route error', async () => {
    const f = fixture(async (_, options) => ({ messages: ['old'], typing: 'unknown', reason: options.timeoutMs ? 'timeout' : undefined }));
    f.req.body.timeout = 10; await f.handler(f.req, f.res);
    expect(f.res.body).toMatchObject({ ok: true, timedOut: true, messages: [] });
  });
  test('invalid arguments are rejected before browser access', async () => {
    const f = fixture(jest.fn()); f.req.body.timeout = 60000;
    await f.handler(f.req, f.res); expect(f.res.statusCode).toBe(400);
    expect(f.tab.page.evaluate).not.toHaveBeenCalled();
  });
});
