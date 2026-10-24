import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Global browser profiles. Each profile owns a stable fingerprint and a
// core session keyed `profile:<id>`, so persistence and tab history (both
// keyed by userId) follow it without extra plumbing.

export const PROFILE_USER_PREFIX = 'profile:';
// Tabs opened without an explicit profile go here. It always exists and
// cannot be deleted.
export const DEFAULT_PROFILE_NAME = 'main';
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
// camoufox-js re-rolls several values on every launch (noise seeds, canvas
// AA offset, window position, history length, the WebGL GPU). A profile pins
// the resolved values from its first launch so it stays the same "machine".
// Locale, timezone, geolocation and WebRTC IPs are left out: they follow the
// proxy/geoip of each launch.
const PINNED_PREFIXES = ['screen.', 'window.', 'navigator.', 'fonts:spacing_seed', 'audio:seed', 'canvas:', 'webGl:', 'webGl2:'];

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

function publicProfile(profile) {
  const { fingerprint, pinnedConfig, ...rest } = profile;
  return {
    ...rest,
    default: profile.name === DEFAULT_PROFILE_NAME,
    // Camoufox rewrites the Firefox version at launch; prefer what it actually sent.
    userAgent: pinnedConfig?.['navigator.userAgent'] || fingerprint?.navigator?.userAgent || null,
    screen: fingerprint?.screen ? { width: fingerprint.screen.width, height: fingerprint.screen.height } : null,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.file - registry JSON path
 * @param {(profile: {kind: string}) => object} opts.generateFingerprint
 * @param {() => number} [opts.now]
 */
export function createProfileRegistry({ file, generateFingerprint, now = Date.now }) {
  let profiles = [];
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(saved)) profiles = saved.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string');
  } catch {}

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, JSON.stringify(profiles, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  function get(nameOrId) {
    if (!nameOrId) return undefined;
    const key = String(nameOrId);
    return profiles.find(p => p.id === key) || profiles.find(p => p.name.toLowerCase() === key.toLowerCase());
  }

  function uniqueBurnerName() {
    for (;;) {
      const name = `burner-${crypto.randomBytes(3).toString('hex')}`;
      if (!get(name)) return name;
    }
  }

  return {
    get,
    list() {
      return profiles.map(publicProfile);
    },
    describe(profile) {
      return profile ? publicProfile(profile) : null;
    },
    /** Return the named profile, creating it if missing. */
    ensure(name) {
      return get(name) || this.create({ name });
    },
    create({ name, burner = false } = {}) {
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
      const at = now();
      const profile = {
        id: crypto.randomUUID(),
        name: finalName,
        kind,
        createdAt: at,
        lastUsedAt: at,
        fingerprint: generateFingerprint({ kind }),
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
    pin(id, config) {
      const profile = profiles.find(p => p.id === id);
      if (!profile) return;
      profile.pinnedConfig = pinnableConfig(config);
      save();
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
      return profiles.filter(p => p.kind === 'burner' && at - p.lastUsedAt > ttlMs);
    },
  };
}
