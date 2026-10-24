import { describe, test, expect } from '@jest/globals';
import {
  GPUS, CORE_COUNTS, advanceDrift, coresFor, defaultSettings, gpuValidFor, launchOverrides, mergeSettings, pickGpu, voicesFor, windowForLaunch,
} from '../../lib/profile-settings.js';

const DAY = 24 * 60 * 60 * 1000;
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

describe('GPUs and cores', () => {
  test('every default GPU is one the OS really reports, never a software renderer', () => {
    for (const os of Object.keys(GPUS)) {
      for (let i = 0; i < 20; i++) {
        const gpu = pickGpu(os);
        expect(gpuValidFor(os, gpu)).toBe(true);
        expect(gpu.renderer).not.toMatch(/SwiftShader|llvmpipe|Basic Render/i);
      }
    }
    expect(gpuValidFor('macos', { vendor: 'Google Inc. (NVIDIA)', renderer: GPUS.windows[0][1] })).toBe(false);
  });

  test('core counts fit the GPU', () => {
    expect(coresFor({ renderer: 'Apple M1, or similar' })).toBe(8);
    expect(coresFor({ renderer: 'Radeon HD 3200 Graphics, or similar' }, () => 0.99)).toBeLessThanOrEqual(4);
    expect(coresFor({ renderer: 'Intel(R) HD Graphics 400, or similar' })).toBe(4);
    for (let i = 0; i < 20; i++) {
      expect(coresFor({ renderer: 'NVIDIA GeForce GTX 980, or similar' })).toBeGreaterThanOrEqual(8);
      expect(CORE_COUNTS).toContain(coresFor({ renderer: 'something else' }));
    }
  });

  test('new profiles get cores for their GPU and a webcam odds per OS', () => {
    for (let i = 0; i < 20; i++) {
      const mac = defaultSettings('macos');
      expect(mac.cores === 8 || mac.gpu.vendor !== 'Apple').toBe(true);
    }
    expect(defaultSettings('macos', seq(0, 0, 0.89)).webcams).toBe(1);
    expect(defaultSettings('linux', seq(0, 0, 0.5)).webcams).toBe(0);
  });
});

describe('mergeSettings', () => {
  const base = defaultSettings('windows');

  test('validates every field', () => {
    expect(() => mergeSettings(base, { cores: 3 }, 'windows')).toThrow(/cores must be one of/);
    expect(() => mergeSettings(base, { mics: 9 }, 'windows')).toThrow(/mics/);
    expect(() => mergeSettings(base, { webcams: 'a' }, 'windows')).toThrow(/webcams/);
    expect(() => mergeSettings(base, { voices: 'loud' }, 'windows')).toThrow(/voices/);
    expect(() => mergeSettings(base, { webrtc: 'maybe' }, 'windows')).toThrow(/webrtc/);
    expect(() => mergeSettings(base, { geoip: 'yes' }, 'windows')).toThrow(/true or false/);
    expect(() => mergeSettings(base, { nope: 1 }, 'windows')).toThrow(/unknown setting/);
    expect(() => mergeSettings(base, [], 'windows')).toThrow(/object/);
    expect(() => mergeSettings(base, { gpu: GPUS.macos.map(([vendor, renderer]) => ({ vendor, renderer }))[0] }, 'windows')).toThrow(/gpu must be/);
    try { mergeSettings(base, { cores: 3 }, 'windows'); } catch (err) { expect(err.statusCode).toBe(400); }
  });

  test('applies valid changes and leaves the rest', () => {
    const next = mergeSettings(base, { cores: 12, webcams: 0, doNotTrack: true }, 'windows');
    expect(next).toMatchObject({ cores: 12, webcams: 0, doNotTrack: true, mics: base.mics, gpu: base.gpu });
    expect(mergeSettings(base, { cores: null }, 'windows').cores).toBeNull();
  });

  test('a new GPU brings cores that fit it unless cores are given', () => {
    const [vendor, renderer] = GPUS.windows.find(([, r]) => /HD Graphics 400/.test(r));
    expect(mergeSettings({ ...base, cores: 16 }, { gpu: { vendor, renderer } }, 'windows').cores).toBe(4);
    expect(mergeSettings({ ...base, cores: 16 }, { gpu: { vendor, renderer }, cores: 8 }, 'windows').cores).toBe(8);
  });

  test('a GPU from another OS is replaced when the OS changes', () => {
    const next = mergeSettings({ ...base, gpu: pickGpu('windows') }, {}, 'macos');
    expect(gpuValidFor('macos', next.gpu)).toBe(true);
  });
});

describe('voices', () => {
  test('Windows lists SAPI voices with David and Zira, led by the language voice', () => {
    const voices = voicesFor('windows', 'fr-FR');
    expect(voices.map(v => v.name)).toEqual(['Microsoft Hortense Desktop - French (France)', 'Microsoft David Desktop - English (United States)', 'Microsoft Zira Desktop - English (United States)']);
    expect(voices.filter(v => v.isDefault)).toHaveLength(1);
    expect(voices[0].voiceUri).toBe('urn:moz-tts:sapi:Microsoft Hortense Desktop - French (France)?fr-FR');
    expect(voicesFor('windows', 'en-US')).toHaveLength(2);
  });

  test('macOS lists many voices with the locale one as default; Linux has none', () => {
    const voices = voicesFor('macos', 'fr-FR');
    expect(voices.length).toBeGreaterThan(10);
    expect(voices.find(v => v.isDefault).lang).toBe('fr-FR');
    expect(voicesFor('linux')).toEqual([]);
  });
});

describe('drift', () => {
  const settings = defaultSettings('linux');

  test('does nothing within a day and is capped at 120 days', () => {
    const start = 5 * DAY;
    expect(advanceDrift(settings, { rolledAt: start }, start + DAY / 2, () => 0)).toMatchObject({ mics: 0, webcams: 0, rolledAt: start });
    // random() = 0 flips every day; an even number of days comes back to unplugged.
    expect(advanceDrift(settings, { rolledAt: start }, start + 1000 * DAY, () => 0).rolledAt).toBe(start + 1000 * DAY);
    expect(advanceDrift(settings, { rolledAt: start }, start + 1000 * DAY, () => 0)).toMatchObject({ mics: 0, speakers: 0, webcams: 0 });
  });

  test('a headset and webcam come and go, and nothing changes when drift is off', () => {
    const start = 5 * DAY;
    expect(advanceDrift(settings, { rolledAt: start }, start + DAY, () => 0)).toMatchObject({ mics: 1, speakers: 1, webcams: 1 });
    expect(advanceDrift({ ...settings, drift: false }, { rolledAt: start, mics: 1 }, start + 30 * DAY, () => 0)).toMatchObject({ mics: 0, speakers: 0, webcams: 0 });
  });
});

describe('windowForLaunch', () => {
  const screen = { availWidth: 1920, availHeight: 1032, availTop: 0 };

  test('mostly maximized, sometimes a smaller restored window inside the screen', () => {
    expect(windowForLaunch(screen, 'windows', () => 0.5)).toEqual({});
    const win = windowForLaunch(screen, 'windows', seq(0.1, 0.5, 0.5, 0.5, 0.5));
    expect(win['window.outerWidth']).toBeLessThan(1920);
    expect(win['window.innerWidth']).toBe(win['window.outerWidth'] - 16);
    expect(win['window.screenX'] + win['window.outerWidth']).toBeLessThanOrEqual(1920);
    expect(windowForLaunch(undefined, 'linux', () => 0)).toEqual({});
  });
});

describe('launchOverrides', () => {
  test('sets devices, privacy flags, GPU and WebRTC', () => {
    const settings = { ...defaultSettings('windows'), mics: 1, speakers: 1, webcams: 1, cores: 8, doNotTrack: true, webrtc: 'block', humanize: false };
    const out = launchOverrides(settings, { os: 'windows', locale: 'en-US', drift: { mics: 1, speakers: 1, webcams: 0 } });
    expect(out.config).toMatchObject({
      'mediaDevices:micros': 2, 'mediaDevices:speakers': 2, 'mediaDevices:webcams': 1,
      'navigator.doNotTrack': '1', 'navigator.globalPrivacyControl': false, 'navigator.hardwareConcurrency': 8,
    });
    expect(out.webgl_config).toEqual([settings.gpu.vendor, settings.gpu.renderer]);
    expect(out).toMatchObject({ block_webrtc: true, humanize: false });
  });

  test('only the listed voices exist, and none for Linux or voices "none"', () => {
    const settings = defaultSettings('windows');
    const win = launchOverrides(settings, { os: 'windows', locale: 'de-DE' }).config;
    expect(win.voices[0].name).toMatch(/Hedda/);
    expect(win).toMatchObject({ 'voices:blockIfNotDefined': true, 'voices:fakeCompletion': true });
    const linux = launchOverrides(defaultSettings('linux'), { os: 'linux' }).config;
    expect(linux.voices).toBeUndefined();
    expect(linux['voices:blockIfNotDefined']).toBe(true);
    expect(launchOverrides({ ...settings, voices: 'none' }, { os: 'windows' }).config.voices).toBeUndefined();
  });

  test('without settings there is nothing to override', () => {
    expect(launchOverrides(undefined, { os: 'linux' })).toEqual({ config: {} });
  });
});
