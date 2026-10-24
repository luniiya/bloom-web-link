import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProfileRegistry, profileUserId, profileIdFromUserId, pinnableConfig, camoufoxConfigFromEnv, parseScreen, fitScreen, parseOS, parseIdentity } from '../../lib/profiles.js';
import { createProfileRuntimes } from '../../lib/profile-runtimes.js';
import { createTabHistory } from '../../lib/tab-history.js';
import { excludeProcessTrees, excludeProfileBrowsers, snapshotOwnedBrowserProcesses, PROFILE_ENV_KEY } from '../../lib/process-ownership.js';

import { GPUS } from '../../lib/profile-settings.js';
const pickGpuFor = os => GPUS[os][1];
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

describe('profile screens', () => {
  test('parses WIDTHxHEIGHT, defaults to 1080p, and rejects nonsense', () => {
    expect(parseScreen()).toEqual({ width: 1920, height: 1080 });
    expect(parseScreen('2560X1440')).toEqual({ width: 2560, height: 1440 });
    expect(parseScreen({ width: 1366, height: 768 })).toEqual({ width: 1366, height: 768 });
    for (const bad of ['1920', 'axb', '800x600', '9000x9000']) {
      expect(() => parseScreen(bad)).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });

  test('fits a maximized window inside the screen minus the taskbar', () => {
    const win = fitScreen({ screen: { colorDepth: 24, devicePixelRatio: 2 } }, { width: 1920, height: 1080 }, 'windows').screen;
    expect(win).toMatchObject({ width: 1920, height: 1080, availHeight: 1032, availTop: 0, outerWidth: 1936, outerHeight: 1048, screenX: -8, screenY: -8, devicePixelRatio: 1, colorDepth: 24 });
    expect(win.innerHeight).toBeLessThan(win.availHeight);

    const mac = fitScreen({ screen: {} }, { width: 1920, height: 1080 }, 'macos').screen;
    expect(mac).toMatchObject({ availHeight: 1055, availTop: 25, outerHeight: 1055, screenX: 0, screenY: 25 });
  });

  test('create and regenerate pass the screen through and reset the pinned config', () => {
    const generate = jest.fn(({ screen }) => ({ navigator: { userAgent: `UA-${Math.random()}` }, screen }));
    const r = createProfileRegistry({ file: path.join(folder, 'profiles.json'), generateFingerprint: generate, now: () => clock });
    const created = r.create({ name: 'laptop', screen: '1366x768' });
    expect(generate).toHaveBeenLastCalledWith({ kind: 'named', screen: { width: 1366, height: 768 }, os: null });
    expect(r.describe(created).screen).toEqual({ width: 1366, height: 768 });
    r.pin(created.id, { 'canvas:seed': 1 });

    const oldAgent = created.fingerprint.navigator.userAgent;
    const fresh = r.regenerate(created.id, {});
    expect(fresh.fingerprint.navigator.userAgent).not.toBe(oldAgent);
    expect(fresh.fingerprint.screen).toEqual({ width: 1920, height: 1080 });
    expect(registry().get('laptop').pinnedConfig).toBeNull();
    expect(r.regenerate('missing')).toBeNull();
    expect(() => r.create({ name: 'tiny', screen: '640x480' })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('profile identity options', () => {
  test('validates os, locale and timezone', () => {
    expect(parseOS()).toBeNull();
    expect(parseOS('Windows')).toBe('windows');
    expect(() => parseOS('android')).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(parseIdentity({})).toEqual({ locale: null, timezone: null });
    expect(parseIdentity({ locale: 'fr-fr', timezone: 'europe/paris' })).toEqual({ locale: 'fr-FR', timezone: 'Europe/Paris' });
    expect(() => parseIdentity({ locale: 'not a locale' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => parseIdentity({ timezone: 'Mars/Olympus' })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('profiles store them, and a new fingerprint keeps the os unless told otherwise', () => {
    const generate = jest.fn(() => ({ navigator: { userAgent: 'UA' }, screen: { width: 1920, height: 1080 } }));
    const r = createProfileRegistry({ file: path.join(folder, 'profiles.json'), generateFingerprint: generate, now: () => clock });
    const created = r.create({ name: 'paris', os: 'windows', locale: 'fr-FR', timezone: 'Europe/Paris' });
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ os: 'windows' }));
    expect(r.describe(created)).toMatchObject({ os: 'windows', locale: 'fr-FR', timezone: 'Europe/Paris' });

    r.regenerate(created.id, { locale: 'fr-FR' });
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ os: 'windows' }));
    expect(registry().get('paris')).toMatchObject({ os: 'windows', locale: 'fr-FR', timezone: null });
    r.regenerate(created.id, { os: '' });
    expect(registry().get('paris').os).toBeNull();
  });
});

describe('profile settings and trash', () => {
  test('new profiles get settings and a drift clock; update keeps the fingerprint', () => {
    const r = registry();
    const created = r.create({ name: 'a', os: 'macos' });
    expect(created.settings.gpu.vendor).toBeTruthy();
    expect(created.drift).toEqual({ rolledAt: clock });
    const before = created.fingerprint;
    r.pin(created.id, { 'canvas:seed': 1, 'webGl:vendor': 'Apple', 'screen.width': 1 });
    const updated = r.update(created.id, { settings: { cores: 8, webcams: 0 }, timezone: 'Europe/Paris', locale: 'fr-FR' });
    expect(updated.fingerprint).toBe(before);
    expect(updated).toMatchObject({ timezone: 'Europe/Paris', locale: 'fr-FR', settings: { cores: 8, webcams: 0 } });
    expect(updated.pinnedConfig['canvas:seed']).toBe(1);
    expect(r.update('missing', {})).toBeNull();
    expect(() => r.update(created.id, { settings: { cores: 3 } })).toThrow(/cores/);
    // Clearing locale goes back to auto.
    expect(r.update(created.id, { locale: '' }).locale).toBeNull();
  });

  test('a profile saved before settings existed gets them on load, keeping a valid pinned GPU', () => {
    const r = registry();
    const created = r.create({ name: 'old', os: 'windows' });
    const file = path.join(folder, 'profiles.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const gpu = pickGpuFor('windows');
    delete saved[0].settings; delete saved[0].drift;
    saved[0].pinnedConfig = { 'webGl:vendor': gpu[0], 'webGl:renderer': gpu[1], 'canvas:seed': 4 };
    fs.writeFileSync(file, JSON.stringify(saved));
    const loaded = registry().get('old');
    expect(loaded.id).toBe(created.id);
    expect(loaded.settings.gpu).toEqual({ vendor: gpu[0], renderer: gpu[1] });
    expect(loaded.drift.rolledAt).toBe(clock);

    saved[0].settings = undefined; saved[0].pinnedConfig = { 'webGl:vendor': 'Bogus', 'webGl:renderer': 'x', 'webGl2:vendor': 'Bogus', 'canvas:seed': 4 };
    fs.writeFileSync(file, JSON.stringify(saved));
    expect(registry().get('old').pinnedConfig).toEqual({ 'canvas:seed': 4 });
  });

  test('deleting moves a profile to the trash; it is hidden, unusable and restorable', () => {
    const r = registry();
    const created = r.create({ name: 'shopping' });
    r.create({ name: 'main' });
    clock += DAY;
    r.trash(created.id);
    expect(r.get('shopping')).toBeUndefined();
    expect(r.list().map(p => p.name)).toEqual(['main']);
    expect(r.listTrash()).toEqual([expect.objectContaining({ name: 'shopping', deletedAt: clock, purgeAt: clock + 30 * DAY })]);
    expect(r.getTrashed('SHOPPING').id).toBe(created.id);
    expect(() => r.create({ name: 'shopping' })).toThrow(/in the trash/);
    expect(() => r.trash(r.get('main').id)).toThrow(/cannot be deleted/);

    // Survives a reload, and burner expiry ignores the trash.
    expect(registry().listTrash()).toHaveLength(1);
    const burner = r.create({ burner: true });
    r.trash(burner.id);
    clock += 100 * DAY;
    expect(r.expired(clock, 30 * DAY).map(p => p.id)).not.toContain(burner.id);

    const back = r.restore(created.id);
    expect(back.deletedAt).toBeUndefined();
    expect(back.lastUsedAt).toBe(clock);
    expect(r.get('shopping').id).toBe(created.id);
    expect(r.restore(created.id)).toBeNull();
  });

  test('profiles are purgeable only after 30 days in the trash', () => {
    const r = registry();
    const created = r.create({ name: 'gone' });
    r.trash(created.id);
    expect(r.purgeable(clock + 29 * DAY)).toEqual([]);
    expect(r.purgeable(clock + 31 * DAY).map(p => p.id)).toEqual([created.id]);
    r.remove(created.id);
    expect(r.listTrash()).toEqual([]);
    expect(() => r.create({ name: 'gone' })).not.toThrow();
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
