import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defaultSettings, gpuValidFor, mergeSettings } from './profile-settings.js';

// Global browser profiles. Each profile owns a stable fingerprint and a
// core session keyed `profile:<id>`, so persistence and tab history (both
// keyed by userId) follow it without extra plumbing.

export const PROFILE_USER_PREFIX = 'profile:';
// Tabs opened without an explicit profile go here. It always exists and
// cannot be deleted.
export const DEFAULT_PROFILE_NAME = 'main';
/** A deleted profile waits in the trash this long before its data is erased. */
export const TRASH_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
// camoufox-js re-rolls several values on every launch (noise seeds, canvas
// AA offset, window position, history length, the WebGL GPU). A profile pins
// the resolved values from its first launch so it stays the same "machine".
// Locale, timezone, geolocation and WebRTC IPs are left out: they follow the
// proxy/geoip of each launch.
const PINNED_PREFIXES = ['screen.', 'window.', 'navigator.', 'fonts:spacing_seed', 'audio:seed', 'canvas:', 'webGl:', 'webGl2:'];

export const DEFAULT_SCREEN = { width: 1920, height: 1080 };
// Space the OS keeps for itself: Windows 11 taskbar (bottom, 48px at 100%),
// the macOS menu bar (top, 25px), a GNOME-style top bar on Linux (32px).
const TASKBARS = { windows: { top: 0, bottom: 48 }, macos: { top: 25, bottom: 0 }, linux: { top: 32, bottom: 0 } };
// Firefox's tab strip + toolbar, so innerHeight is what a real window shows.
const BROWSER_CHROME_PX = 85;

/** Parse "1920x1080" or {width, height} into a sane screen size, or throw a 400. */
export function parseScreen(value) {
  if (value === undefined || value === null || value === '') return { ...DEFAULT_SCREEN };
  const [width, height] = typeof value === 'string' ? value.toLowerCase().split('x').map(Number) : [Number(value.width), Number(value.height)];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1024 || height < 600 || width > 7680 || height > 4320) {
    throw Object.assign(new Error('screen must be WIDTHxHEIGHT between 1024x600 and 7680x4320'), { statusCode: 400 });
  }
  return { width, height };
}

export const PROFILE_OSES = ['windows', 'macos', 'linux'];

/** null keeps the host OS; otherwise one of PROFILE_OSES. */
export function parseOS(value) {
  if (value === undefined || value === null || value === '') return null;
  const os = String(value).toLowerCase();
  if (!PROFILE_OSES.includes(os)) throw Object.assign(new Error(`os must be one of ${PROFILE_OSES.join(', ')}`), { statusCode: 400 });
  return os;
}

/** Optional locale ("fr-FR") and IANA timezone ("Europe/Paris"); empty means follow the proxy / server default. */
export function parseIdentity({ locale, timezone } = {}) {
  const out = { locale: null, timezone: null };
  if (locale) {
    try { [out.locale] = Intl.getCanonicalLocales(String(locale)); } catch {}
    if (!out.locale || !/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/.test(out.locale)) {
      throw Object.assign(new Error('locale must look like "en-US" or "fr-FR"'), { statusCode: 400 });
    }
  }
  if (timezone) {
    try { out.timezone = new Intl.DateTimeFormat('en-US', { timeZone: String(timezone) }).resolvedOptions().timeZone; }
    catch { throw Object.assign(new Error('timezone must be an IANA name like "Europe/Paris"'), { statusCode: 400 }); }
  }
  return out;
}

/**
 * Give a generated fingerprint a believable desktop: the chosen screen at 1x,
 * the OS taskbar taken out of the available area, and a maximized browser
 * window filling what is left (Windows maximizes 8px past each edge).
 */
export function fitScreen(fingerprint, { width, height } = DEFAULT_SCREEN, os = 'linux') {
  const bar = TASKBARS[os] || TASKBARS.linux;
  const availHeight = height - bar.top - bar.bottom;
  const overhang = os === 'windows' ? 8 : 0;
  const outerWidth = width + overhang * 2;
  const outerHeight = availHeight + overhang * 2;
  fingerprint.screen = {
    ...fingerprint.screen,
    width, height,
    availWidth: width, availHeight,
    availLeft: 0, availTop: bar.top,
    outerWidth, outerHeight,
    innerWidth: width,
    innerHeight: availHeight - BROWSER_CHROME_PX,
    screenX: 0 - overhang,
    screenY: bar.top - overhang,
    pageXOffset: 0, pageYOffset: 0,
    devicePixelRatio: 1,
  };
  return fingerprint;
}

export function pinnableConfig(config) {
  return Object.fromEntries(Object.entries(config || {}).filter(([key]) =>
    PINNED_PREFIXES.some(prefix => key.startsWith(prefix)) && !key.startsWith('navigator.language')));
}

/** Reassemble the config camoufox-js hands Firefox through CAMOU_CONFIG_<n> env chunks. */
export function camoufoxConfigFromEnv(env = {}) {
  let json = '';
  for (let i = 1; env[`CAMOU_CONFIG_${i}`] !== undefined; i++) json += env[`CAMOU_CONFIG_${i}`];
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

export function profileUserId(profileId) {
  return `${PROFILE_USER_PREFIX}${profileId}`;
}

export function profileIdFromUserId(userId) {
  const key = String(userId ?? '');
  return key.startsWith(PROFILE_USER_PREFIX) ? key.slice(PROFILE_USER_PREFIX.length) : null;
}

const dropPinned = (pinned, ...prefixes) => pinned && Object.fromEntries(Object.entries(pinned).filter(([key]) => !prefixes.some(p => key.startsWith(p))));

function publicProfile(profile) {
  const { fingerprint, pinnedConfig, drift, deletedAt, ...rest } = profile;
  return {
    ...rest,
    ...(deletedAt ? { deletedAt, purgeAt: deletedAt + TRASH_TTL_DAYS * DAY_MS } : {}),
    default: profile.name === DEFAULT_PROFILE_NAME,
    // Camoufox rewrites the Firefox version at launch; prefer what it actually sent.
    userAgent: pinnedConfig?.['navigator.userAgent'] || fingerprint?.navigator?.userAgent || null,
    screen: fingerprint?.screen ? { width: fingerprint.screen.width, height: fingerprint.screen.height } : null,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.file - registry JSON path
 * @param {(profile: {kind: string, screen: {width: number, height: number}, os: string | null}) => object} opts.generateFingerprint
 * @param {() => number} [opts.now]
 * @param {string} [opts.hostOS] - OS used when a profile doesn't pick one
 */
export function createProfileRegistry({ file, generateFingerprint, now = Date.now, hostOS = 'linux' }) {
  let profiles = [];
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(saved)) profiles = saved.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string');
  } catch {}
  const osOf = profile => profile.os || hostOS;

  // Profiles from before settings existed keep the GPU they already show.
  let migrated = false;
  for (const profile of profiles) {
    if (profile.settings) continue;
    const settings = defaultSettings(osOf(profile));
    const pinnedGpu = { vendor: profile.pinnedConfig?.['webGl:vendor'], renderer: profile.pinnedConfig?.['webGl:renderer'] };
    if (gpuValidFor(osOf(profile), pinnedGpu)) settings.gpu = pinnedGpu;
    else profile.pinnedConfig = dropPinned(profile.pinnedConfig, 'webGl:', 'webGl2:');
    profile.settings = settings;
    profile.drift = { rolledAt: now() };
    migrated = true;
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(profiles, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  const find = (nameOrId, list) => {
    if (!nameOrId) return undefined;
    const key = String(nameOrId);
    return list.find(p => p.id === key) || list.find(p => p.name.toLowerCase() === key.toLowerCase());
  };
  // Trashed profiles are invisible here: they can't be used, listed or launched.
  const get = nameOrId => find(nameOrId, profiles.filter(p => !p.deletedAt));
  const getTrashed = nameOrId => find(nameOrId, profiles.filter(p => p.deletedAt));

  function uniqueBurnerName() {
    for (;;) {
      const name = `burner-${crypto.randomBytes(3).toString('hex')}`;
      if (!get(name)) return name;
    }
  }

  if (migrated) save();

  return {
    get,
    getTrashed,
    osOf,
    list() {
      return profiles.filter(p => !p.deletedAt).map(publicProfile);
    },
    /** Deleted profiles still holding their data, newest deletion first. */
    listTrash() {
      return profiles.filter(p => p.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt).map(publicProfile);
    },
    describe(profile) {
      return profile ? publicProfile(profile) : null;
    },
    /** Return the named profile, creating it if missing. */
    ensure(name) {
      return get(name) || this.create({ name });
    },
    create({ name, burner = false, screen, os, locale, timezone, settings } = {}) {
      const kind = burner ? 'burner' : 'named';
      let finalName = name === undefined || name === null || name === '' ? null : String(name).trim();
      if (!finalName) {
        if (!burner) throw Object.assign(new Error('name is required for a named profile'), { statusCode: 400 });
        finalName = uniqueBurnerName();
      }
      if (!NAME_RE.test(finalName) || finalName.toLowerCase() === 'burner') {
        throw Object.assign(new Error('profile name must be 1-64 chars of letters, digits, "_", "-" or ".", and not "burner"'), { statusCode: 400 });
      }
      if (get(finalName)) {
        throw Object.assign(new Error(`profile "${finalName}" already exists`), { statusCode: 409 });
      }
      if (getTrashed(finalName)) {
        throw Object.assign(new Error(`profile "${finalName}" is in the trash; restore it or wait for it to be erased`), { statusCode: 409, code: 'profile_in_trash' });
      }
      const size = parseScreen(screen);
      const system = parseOS(os);
      const identity = parseIdentity({ locale, timezone });
      const chosen = mergeSettings(defaultSettings(system || hostOS), settings, system || hostOS);
      const at = now();
      const profile = {
        id: crypto.randomUUID(),
        name: finalName,
        kind,
        createdAt: at,
        lastUsedAt: at,
        os: system,
        ...identity,
        settings: chosen,
        drift: { rolledAt: at },
        fingerprint: generateFingerprint({ kind, screen: size, os: system }),
        pinnedConfig: null, // filled from the first launch
      };
      profiles.push(profile);
      save();
      return profile;
    },
    // Debounced: tab activity calls this on every request.
    touch(id, minIntervalMs = 60_000) {
      const profile = profiles.find(p => p.id === id);
      const at = now();
      if (!profile || at - profile.lastUsedAt < minIntervalMs) return;
      profile.lastUsedAt = at;
      save();
    },
    /** Fresh fingerprint (new "machine"); the next launch pins its resolved config again. */
    regenerate(id, { screen, os, locale, timezone, settings } = {}) {
      const profile = profiles.find(p => p.id === id);
      if (!profile) return null;
      const size = parseScreen(screen);
      const system = os === undefined ? profile.os ?? null : parseOS(os);
      const identity = parseIdentity({ locale, timezone });
      const chosen = mergeSettings(profile.settings || defaultSettings(system || hostOS), settings, system || hostOS);
      Object.assign(profile, identity, { os: system, settings: chosen });
      profile.fingerprint = generateFingerprint({ kind: profile.kind, screen: size, os: system });
      profile.pinnedConfig = null;
      save();
      return profile;
    },
    /**
     * Change settings in place, keeping the fingerprint. Screen size is
     * re-fitted; a different OS needs a whole new fingerprint (regenerate).
     */
    update(id, { screen, locale, timezone, settings } = {}) {
      const profile = profiles.find(p => p.id === id);
      if (!profile) return null;
      const next = mergeSettings(profile.settings || defaultSettings(osOf(profile)), settings, osOf(profile));
      if (locale !== undefined || timezone !== undefined) {
        Object.assign(profile, parseIdentity({ locale: locale ?? profile.locale, timezone: timezone ?? profile.timezone }));
      }
      if (screen !== undefined) {
        fitScreen(profile.fingerprint, parseScreen(screen), osOf(profile));
        profile.pinnedConfig = dropPinned(profile.pinnedConfig, 'screen.', 'window.');
      }
      if (profile.settings?.gpu?.renderer !== next.gpu.renderer || profile.settings?.gpu?.vendor !== next.gpu.vendor) {
        profile.pinnedConfig = dropPinned(profile.pinnedConfig, 'webGl:', 'webGl2:');
      }
      profile.settings = next;
      save();
      return profile;
    },
    /** Roll the profile's slow device drift forward; called at each browser launch. */
    setDrift(id, drift) {
      const profile = profiles.find(p => p.id === id);
      if (!profile) return;
      profile.drift = drift;
      save();
    },
    pin(id, config) {
      const profile = profiles.find(p => p.id === id);
      if (!profile) return;
      profile.pinnedConfig = pinnableConfig(config);
      save();
    },
    /** Soft delete: hides the profile; its data stays until purgeable() lists it. */
    trash(id) {
      const profile = profiles.find(p => p.id === id && !p.deletedAt);
      if (!profile) return null;
      if (profile.name === DEFAULT_PROFILE_NAME) {
        throw Object.assign(new Error(`the "${DEFAULT_PROFILE_NAME}" profile cannot be deleted`), { statusCode: 409, code: 'profile_protected' });
      }
      profile.deletedAt = now();
      save();
      return profile;
    },
    restore(id) {
      const profile = profiles.find(p => p.id === id && p.deletedAt);
      if (!profile) return null;
      delete profile.deletedAt;
      // Restoring counts as use, so a restored burner isn't wiped right away.
      profile.lastUsedAt = now();
      save();
      return profile;
    },
    /** Trashed profiles past their retention. */
    purgeable(at = now()) {
      return profiles.filter(p => p.deletedAt && at - p.deletedAt > TRASH_TTL_DAYS * DAY_MS);
    },
    remove(id) {
      if (profiles.find(p => p.id === id)?.name === DEFAULT_PROFILE_NAME) {
        throw Object.assign(new Error(`the "${DEFAULT_PROFILE_NAME}" profile cannot be deleted`), { statusCode: 409, code: 'profile_protected' });
      }
      const before = profiles.length;
      profiles = profiles.filter(p => p.id !== id);
      if (profiles.length !== before) save();
      return profiles.length !== before;
    },
    expired(at, ttlMs) {
      if (!(ttlMs > 0)) return [];
      return profiles.filter(p => !p.deletedAt && p.kind === 'burner' && at - p.lastUsedAt > ttlMs);
    },
  };
}
