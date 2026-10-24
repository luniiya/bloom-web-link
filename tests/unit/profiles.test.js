import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProfileRegistry, profileUserId, profileIdFromUserId, pinnableConfig, camoufoxConfigFromEnv } from '../../lib/profiles.js';
import { createProfileRuntimes } from '../../lib/profile-runtimes.js';
import { createTabHistory } from '../../lib/tab-history.js';
import { excludeProcessTrees, excludeProfileBrowsers, snapshotOwnedBrowserProcesses, PROFILE_ENV_KEY } from '../../lib/process-ownership.js';

const DAY = 24 * 60 * 60 * 1000;
let folder;
let clock;
const fingerprint = () => ({ navigator: { userAgent: `UA-${Math.random()}` }, screen: { width: 1920, height: 1080 } });
const registry = () => createProfileRegistry({ file: path.join(folder, 'profiles.json'), generateFingerprint: fingerprint, now: () => clock });

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bwl-profiles-'));
  clock = 1_000_000;
});
afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

describe('profile registry', () => {
  test('creates named profiles with a stable fingerprint and pinned config that survive reload', () => {
    const r = registry();
    const created = r.create({ name: 'shopping' });
    expect(created).toMatchObject({ name: 'shopping', kind: 'named', pinnedConfig: null });
    r.pin(created.id, { 'canvas:seed': 7, 'canvas:aaOffset': -3, 'webGl:vendor': 'Intel', timezone: 'Europe/Paris' });

    const reloaded = registry().get('SHOPPING');
    expect(reloaded.id).toBe(created.id);
    expect(reloaded.fingerprint).toEqual(created.fingerprint);
    expect(reloaded.pinnedConfig).toEqual({ 'canvas:seed': 7, 'canvas:aaOffset': -3, 'webGl:vendor': 'Intel' });
    expect(fs.statSync(path.join(folder, 'profiles.json')).mode & 0o777).toBe(0o600);
  });

  test('each profile gets its own fingerprint', () => {
    const r = registry();
    const a = r.create({ name: 'a' });
    const b = r.create({ name: 'b' });
    expect(a.fingerprint.navigator.userAgent).not.toBe(b.fingerprint.navigator.userAgent);
  });

  test('pins machine traits but not proxy-dependent identity', () => {
    expect(pinnableConfig({
      'screen.width': 1920, 'window.screenY': 4, 'window.history.length': 2, 'navigator.userAgent': 'UA',
      'fonts:spacing_seed': 1, 'audio:seed': 2, 'canvas:seed': 3, 'canvas:aaOffset': 4, 'webGl:vendor': 'V', 'webGl2:parameters': {},
      'navigator.language': 'fr', 'navigator.languages': ['fr'], 'locale:language': 'fr', timezone: 'X', 'geolocation:latitude': 1,
      'webrtc:ipv4': '1.2.3.4', fonts: ['Arimo'], addons: [], humanize: true,
    })).toEqual({
      'screen.width': 1920, 'window.screenY': 4, 'window.history.length': 2, 'navigator.userAgent': 'UA',
      'fonts:spacing_seed': 1, 'audio:seed': 2, 'canvas:seed': 3, 'canvas:aaOffset': 4, 'webGl:vendor': 'V', 'webGl2:parameters': {},
    });
  });

  test('reassembles chunked CAMOU_CONFIG env', () => {
    const json = JSON.stringify({ 'canvas:seed': 9, 'screen.width': 800 });
    expect(camoufoxConfigFromEnv({ CAMOU_CONFIG_1: json.slice(0, 10), CAMOU_CONFIG_2: json.slice(10), OTHER: 'x' })).toEqual({ 'canvas:seed': 9, 'screen.width': 800 });
    expect(camoufoxConfigFromEnv({})).toBeNull();
  });

  test('burners get generated unique names; named profiles need a valid, unused name', () => {
    const r = registry();
    const burner = r.create({ burner: true });
    expect(burner).toMatchObject({ kind: 'burner' });
    expect(burner.name).toMatch(/^burner-[0-9a-f]{6}$/);
    r.create({ name: 'work' });
    expect(() => r.create({ name: 'work' })).toThrow(/already exists/);
    expect(() => r.create({})).toThrow(/name is required/);
    expect(() => r.create({ name: '../etc' })).toThrow(/profile name/);
    expect(() => r.create({ name: 'burner' })).toThrow(/profile name/);
  });

  test('list hides fingerprint internals', () => {
    const r = registry();
    r.create({ name: 'a' });
    const [listed] = r.list();
    expect(listed.fingerprint).toBeUndefined();
    expect(listed.pinnedConfig).toBeUndefined();
    expect(listed.userAgent).toMatch(/^UA-/);
  });

  test('only burners unused past the TTL expire, and touch is debounced', () => {
    const r = registry();
    const burner = r.create({ burner: true });
    r.create({ name: 'kept' });
    clock += 31 * DAY;
    expect(r.expired(clock, 30 * DAY).map(p => p.id)).toEqual([burner.id]);
    expect(r.expired(clock, 0)).toEqual([]);

    r.touch(burner.id);
    expect(r.expired(clock, 30 * DAY)).toEqual([]);
    const usedAt = r.get(burner.id).lastUsedAt;
    clock += 1000;
    r.touch(burner.id);
    expect(r.get(burner.id).lastUsedAt).toBe(usedAt);

    expect(r.remove(burner.id)).toBe(true);
    expect(registry().get(burner.id)).toBeUndefined();
  });

  test('the default main profile is created once and cannot be deleted', () => {
    const r = registry();
    const main = r.ensure('main');
    expect(r.ensure('main').id).toBe(main.id);
    expect(r.list()[0]).toMatchObject({ name: 'main', default: true });
    expect(() => r.remove(main.id)).toThrow(/cannot be deleted/);
    expect(registry().get('main').id).toBe(main.id);
  });

  test('user id mapping round-trips', () => {
    expect(profileIdFromUserId(profileUserId('abc'))).toBe('abc');
    expect(profileIdFromUserId('mcp-123')).toBeNull();
  });
});

describe('profile runtimes', () => {
  const fakeBrowser = pid => ({ isConnected: () => true, process: () => ({ pid }) });

  test('launches once per profile, enforces the live browser cap, and closes on idle', async () => {
    jest.useFakeTimers();
    try {
      let pid = 100;
      const launch = jest.fn(async () => ({ browser: fakeBrowser(pid++), virtualDisplay: { proc: { pid: pid++ } } }));
      const close = jest.fn(async () => {});
      const runtimes = createProfileRuntimes({ launch, close, maxBrowsers: 1, idleMs: 5000 });

      const [b1, b2] = await Promise.all([runtimes.ensure({ id: 'a' }), runtimes.ensure({ id: 'a' })]);
      expect(b1).toBe(b2);
      expect(launch).toHaveBeenCalledTimes(1);
      expect([...runtimes.ownedPids()]).toEqual([100, 101]);
      await expect(runtimes.ensure({ id: 'b' })).rejects.toMatchObject({ statusCode: 503, code: 'admission_rejected' });

      runtimes.scheduleIdle('a', false);
      await jest.advanceTimersByTimeAsync(5000);
      expect(close).toHaveBeenCalledTimes(1);
      expect(runtimes.has('a')).toBe(false);
      await runtimes.ensure({ id: 'b' });
      expect(launch).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a failed launch frees the slot', async () => {
    const runtimes = createProfileRuntimes({
      launch: async () => { throw new Error('boom'); },
      close: async () => {},
      maxBrowsers: 1,
      idleMs: 0,
    });
    await expect(runtimes.ensure({ id: 'a' })).rejects.toThrow('boom');
    expect(runtimes.has('a')).toBe(false);
    expect(runtimes.failure('a')).toMatchObject({ reason: 'launch_failed: boom' });
  });

  test('a browser that dies frees its slot without waiting for the next request', async () => {
    let onDisconnect;
    const browser = { isConnected: () => true, on: (event, fn) => { if (event === 'disconnected') onDisconnect = fn; } };
    const close = jest.fn(async () => {});
    const runtimes = createProfileRuntimes({ launch: async () => ({ browser }), close, maxBrowsers: 1, idleMs: 0 });
    await runtimes.ensure({ id: 'a' });
    onDisconnect();
    await Promise.resolve(); await Promise.resolve();
    expect(runtimes.has('a')).toBe(false);
    expect(close).toHaveBeenCalledWith(expect.anything(), 'browser_disconnected');
    // Reported as a crash until the next good launch.
    expect(runtimes.failure('a')).toMatchObject({ reason: 'browser_disconnected' });
    await runtimes.ensure({ id: 'a' });
    expect(runtimes.failure('a')).toBeNull();
  });

  test('intentional closes are not failures, and forget clears one', async () => {
    const runtimes = createProfileRuntimes({ launch: async () => ({ browser: { isConnected: () => true } }), close: async () => {}, maxBrowsers: 1, idleMs: 0 });
    await runtimes.ensure({ id: 'a' });
    await runtimes.close('a', 'idle_shutdown');
    expect(runtimes.failure('a')).toBeNull();
    const failing = createProfileRuntimes({ launch: async () => { throw new Error('x'); }, close: async () => {}, maxBrowsers: 1, idleMs: 0 });
    await failing.ensure({ id: 'b' }).catch(() => {});
    failing.forget('b');
    expect(failing.failure('b')).toBeNull();
  });

  test('relaunches a disconnected browser', async () => {
    let connected = true;
    const launch = jest.fn(async () => ({ browser: { isConnected: () => connected } }));
    const close = jest.fn(async () => {});
    const runtimes = createProfileRuntimes({ launch, close, maxBrowsers: 2, idleMs: 0 });
    await runtimes.ensure({ id: 'a' });
    connected = false;
    await runtimes.ensure({ id: 'a' });
    expect(close).toHaveBeenCalledWith(expect.anything(), 'browser_disconnected');
    expect(launch).toHaveBeenCalledTimes(2);
  });
});

describe('tab history retention', () => {
  test('caps per user, so one session cannot evict profile history', () => {
    const h = createTabHistory(path.join(folder, 'history.json'), 2, 3);
    h.record('profile:p', 'kept', {}, 'user_closed');
    for (let i = 0; i < 10; i++) h.record(`mcp-${i}`, String(i), {}, 'user_closed');
    expect(h.get('profile:p', 'kept')).toBeDefined();
    expect(h.list().filter(e => !e.userId.startsWith('profile:'))).toHaveLength(3);

    for (let i = 0; i < 3; i++) h.record('profile:p', `t${i}`, {}, 'user_closed');
    expect(h.list('profile:p').map(e => e.tabId)).toEqual(['t1', 't2']);

    h.removeUser('profile:p');
    expect(h.list('profile:p')).toEqual([]);
  });
});

describe('excludeProfileBrowsers', () => {
  test('keeps only untagged processes outside the excluded trees', () => {
    const snapshot = [
      { pid: 10, ppid: 1, profileId: null }, { pid: 11, ppid: 10, profileId: null },
      { pid: 20, ppid: 1, profileId: 'p1' }, { pid: 21, ppid: 20, profileId: 'p1' },
      { pid: 30, ppid: 1, profileId: null }, // a profile's Xvfb
    ];
    expect(excludeProfileBrowsers(snapshot, new Set([30])).map(p => p.pid)).toEqual([10, 11]);
  });

  test('reads the profile tag from each process environment', () => {
    const proc = path.join(folder, 'proc');
    const add = (pid, ppid, cmd, environ) => {
      fs.mkdirSync(path.join(proc, String(pid)), { recursive: true });
      fs.writeFileSync(path.join(proc, String(pid), 'status'), `PPid:\t${ppid}\n`);
      fs.writeFileSync(path.join(proc, String(pid), 'stat'), `${pid} (x) S ${ppid} ${'0 '.repeat(18)}123`);
      fs.writeFileSync(path.join(proc, String(pid), 'cmdline'), cmd);
      fs.writeFileSync(path.join(proc, String(pid), 'environ'), environ.join('\0'));
    };
    add(1, 0, 'node', []);
    add(2, 1, '/opt/camoufox-bin', ['HOME=/root']);
    add(3, 1, '/opt/camoufox-bin', ['HOME=/root', `${PROFILE_ENV_KEY}=p1`]);
    expect(snapshotOwnedBrowserProcesses(1, proc).map(p => [p.pid, p.profileId])).toEqual([[2, null], [3, 'p1']]);
  });
});

describe('excludeProcessTrees', () => {
  test('drops live profile browsers and their children from default-browser cleanup', () => {
    const snapshot = [
      { pid: 10, ppid: 1 }, { pid: 11, ppid: 10 },
      { pid: 20, ppid: 1 }, { pid: 21, ppid: 20 }, { pid: 22, ppid: 21 },
      { pid: 30, ppid: 1 },
    ];
    expect(excludeProcessTrees(snapshot, new Set([20, 30])).map(p => p.pid)).toEqual([10, 11]);
    expect(excludeProcessTrees(snapshot, new Set())).toBe(snapshot);
  });
});
