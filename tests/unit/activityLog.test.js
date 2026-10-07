import { describe, test, expect } from '@jest/globals';
import { createActivityLog, parseTabRequest, summarizeCall } from '../../lib/activity-log.js';

describe('parseTabRequest', () => {
  test('maps tab-scoped routes to tool-style action names', () => {
    expect(parseTabRequest('POST', '/tabs/abc/click')).toEqual({ tabId: 'abc', action: 'click' });
    expect(parseTabRequest('GET', '/tabs/abc/snapshot')).toEqual({ tabId: 'abc', action: 'snapshot' });
    expect(parseTabRequest('POST', '/tabs/abc/element-state')).toEqual({ tabId: 'abc', action: 'element_state' });
    expect(parseTabRequest('POST', '/tabs/a%20b/type')).toEqual({ tabId: 'a b', action: 'type' });
  });

  test('DELETE /tabs/:id is close_tab; other bare tab paths are ignored', () => {
    expect(parseTabRequest('DELETE', '/tabs/abc')).toEqual({ tabId: 'abc', action: 'close_tab' });
    expect(parseTabRequest('GET', '/tabs/abc')).toBeNull();
  });

  test('create_tab needs the id from the response', () => {
    expect(parseTabRequest('POST', '/tabs')).toBeNull();
    expect(parseTabRequest('POST', '/tabs', 'new-id')).toEqual({ tabId: 'new-id', action: 'create_tab' });
  });

  test('ignores non-tab routes and tab groups', () => {
    expect(parseTabRequest('GET', '/tabs')).toBeNull();
    expect(parseTabRequest('GET', '/health')).toBeNull();
    expect(parseTabRequest('GET', '/dashboard/state')).toBeNull();
    expect(parseTabRequest('DELETE', '/tabs/group/xyz')).toBeNull();
    expect(parseTabRequest('POST', '/tabs/abc/click/extra')).toBeNull();
  });
});

describe('summarizeCall', () => {
  test('describes the target of a call', () => {
    expect(summarizeCall('click', { ref: 'e12' })).toBe('e12');
    expect(summarizeCall('click', { selector: '#go' })).toBe('#go');
    expect(summarizeCall('click', { coordinates: { x: 10.4, y: 20.6 } })).toBe('(10, 21)');
    expect(summarizeCall('navigate', { url: 'https://example.com' })).toBe('https://example.com');
    expect(summarizeCall('navigate', { macro: '@google_search', query: 'cats' })).toBe('@google_search cats');
    expect(summarizeCall('press', { key: 'Enter' })).toBe('Enter');
    expect(summarizeCall('batch', { actions: [{}, {}, {}] })).toBe('3 actions');
    expect(summarizeCall('snapshot', {}, { offset: '400' })).toBe('offset 400');
  });

  test('type shows the text and whether Enter follows', () => {
    expect(summarizeCall('type', { ref: 'e3', text: 'hello' })).toBe('e3 "hello"');
    expect(summarizeCall('type', { text: 'hi', pressEnter: true })).toBe('"hi" ⏎');
  });

  test('truncates long details and collapses whitespace', () => {
    const detail = summarizeCall('evaluate', { expression: `  a\n\n${'x'.repeat(500)}` });
    expect(detail.length).toBeLessThanOrEqual(120);
    expect(detail.startsWith('a x')).toBe(true);
    expect(detail.endsWith('…')).toBe(true);
  });

  test('unknown actions and missing fields summarize to an empty string', () => {
    expect(summarizeCall('screenshot')).toBe('');
    expect(summarizeCall('click', {})).toBe('');
    expect(summarizeCall('mystery', { anything: 1 })).toBe('');
  });
});

describe('createActivityLog', () => {
  test('records entries per tab with increasing seq and a timestamp', () => {
    const log = createActivityLog();
    const a = log.record('t1', { action: 'click' });
    const b = log.record('t2', { action: 'type' });
    const c = log.record('t1', { action: 'press' });
    expect(a.seq).toBeLessThan(b.seq);
    expect(b.seq).toBeLessThan(c.seq);
    expect(Number.isNaN(Date.parse(a.ts))).toBe(false);
    expect(log.list('t1').map((e) => e.action)).toEqual(['click', 'press']);
    expect(log.list('t2').map((e) => e.action)).toEqual(['type']);
    expect(log.list('unknown')).toEqual([]);
  });

  test('since returns only newer entries', () => {
    const log = createActivityLog();
    const first = log.record('t', { action: 'a' });
    log.record('t', { action: 'b' });
    expect(log.list('t', first.seq).map((e) => e.action)).toEqual(['b']);
    expect(log.list('t', 9999)).toEqual([]);
  });

  test('caps entries per tab, dropping the oldest', () => {
    const log = createActivityLog({ maxEntriesPerTab: 3 });
    for (const action of ['1', '2', '3', '4', '5']) log.record('t', { action });
    expect(log.list('t').map((e) => e.action)).toEqual(['3', '4', '5']);
  });

  test('caps tabs, evicting the least recently active', () => {
    const log = createActivityLog({ maxTabs: 2 });
    log.record('old', { action: 'x' });
    log.record('mid', { action: 'x' });
    log.record('old', { action: 'y' }); // touching "old" makes "mid" the eviction candidate
    log.record('new', { action: 'x' });
    expect(log.size).toBe(2);
    expect(log.list('mid')).toEqual([]);
    expect(log.list('old')).toHaveLength(2);
    expect(log.list('new')).toHaveLength(1);
  });
});
