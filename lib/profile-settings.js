// Per-profile browser settings on top of the generated fingerprint: GPU, CPU
// cores, media devices, speech voices, privacy flags, WebRTC, geoip, and a
// slow "drift" of the traits that change on real machines (a headset or
// webcam plugged in, a window that isn't maximized today).
//
// Settings are applied as Camoufox config overrides at launch, after the
// values pinned from the profile's first launch, so they can change without
// re-rolling the whole fingerprint.

const DAY = 24 * 60 * 60 * 1000;

// Real-world GPU pairs from camoufox-js's WebGL database, weighted by how
// often each shows up there. Software renderers (SwiftShader, llvmpipe,
// Microsoft Basic Render Driver) are left out: they mark VMs and bots.
export const GPUS = {
  windows: [
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar', 0.45],
    ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) HD Graphics Direct3D11 vs_5_0 ps_5_0), or similar', 0.19],
    ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0), or similar', 0.15],
    ['Google Inc. (AMD)', 'ANGLE (AMD, Radeon HD 3200 Graphics Direct3D11 vs_5_0 ps_5_0), or similar', 0.08],
    ['Google Inc. (AMD)', 'ANGLE (AMD, Radeon R9 200 Series Direct3D11 vs_5_0 ps_5_0), or similar', 0.05],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 480 Direct3D11 vs_5_0 ps_5_0), or similar', 0.01],
  ],
  macos: [
    ['Apple', 'Apple M1, or similar', 0.82],
    ['Intel Inc.', 'Intel(R) HD Graphics 400, or similar', 0.07],
    ['ATI Technologies Inc.', 'Radeon R9 200 Series, or similar', 0.04],
    ['Intel Inc.', 'Intel(R) HD Graphics, or similar', 0.03],
  ],
  linux: [
    ['Intel', 'Intel(R) HD Graphics, or similar', 0.28],
    ['NVIDIA Corporation', 'NVIDIA GeForce GTX 980, or similar', 0.25],
    ['Intel', 'Intel(R) HD Graphics 400, or similar', 0.15],
    ['AMD', 'Radeon R9 200 Series, or similar', 0.1],
    ['AMD', 'Radeon HD 3200 Graphics, or similar', 0.08],
  ],
};

export const CORE_COUNTS = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32];

// Desktop Firefox lists the OS's installed text-to-speech voices. Windows
// ships David and Zira plus one voice for the display language; macOS has
// a large set; most Linux desktops have no speech-dispatcher voices at all.
const WINDOWS_VOICES = {
  'en-US': [], // David and Zira are added for everyone
  'en-GB': ['Hazel', 'English (Great Britain)'],
  'fr-FR': ['Hortense', 'French (France)'],
  'de-DE': ['Hedda', 'German (Germany)'],
  'es-ES': ['Helena', 'Spanish (Spain)'],
  'it-IT': ['Elsa', 'Italian (Italy)'],
  'pt-BR': ['Maria', 'Portuguese (Brazil)'],
  'ja-JP': ['Haruka', 'Japanese'],
  'ko-KR': ['Heami', 'Korean'],
  'zh-CN': ['Huihui', 'Chinese (Simplified)'],
};
const MAC_VOICES = [
  ['Samantha', 'en-US'], ['Daniel', 'en-GB'], ['Karen', 'en-AU'], ['Moira', 'en-IE'], ['Rishi', 'en-IN'], ['Tessa', 'en-ZA'],
  ['Thomas', 'fr-FR'], ['Amélie', 'fr-CA'], ['Anna', 'de-DE'], ['Mónica', 'es-ES'], ['Paulina', 'es-MX'], ['Alice', 'it-IT'],
  ['Luciana', 'pt-BR'], ['Joana', 'pt-PT'], ['Xander', 'nl-NL'], ['Kyoko', 'ja-JP'], ['Yuna', 'ko-KR'], ['Tingting', 'zh-CN'],
  ['Meijia', 'zh-TW'], ['Milena', 'ru-RU'], ['Zosia', 'pl-PL'], ['Alva', 'sv-SE'], ['Yelda', 'tr-TR'], ['Carmit', 'he-IL'],
];

export function voicesFor(os, locale = 'en-US') {
  if (os === 'windows') {
    const voice = (name, lang, label) => ({ isLocalService: true, isDefault: false, voiceUri: `urn:moz-tts:sapi:Microsoft ${name} Desktop - ${label}?${lang}`, name: `Microsoft ${name} Desktop - ${label}`, lang });
    const own = WINDOWS_VOICES[locale]?.length ? [voice(WINDOWS_VOICES[locale][0], locale, WINDOWS_VOICES[locale][1])] : [];
    const list = [...own, voice('David', 'en-US', 'English (United States)'), voice('Zira', 'en-US', 'English (United States)')];
    list[0].isDefault = true;
    return list;
  }
  if (os === 'macos') {
    const list = MAC_VOICES.map(([name, lang]) => ({ isLocalService: true, isDefault: false, voiceUri: `urn:moz-tts:osx:com.apple.voice.compact.${lang}.${name}`, name, lang }));
    (list.find(v => v.lang === locale) || list[0]).isDefault = true;
    return list;
  }
  return [];
}

function weighted(items, weightOf, random) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = random() * total;
  for (const item of items) { roll -= weightOf(item); if (roll <= 0) return item; }
  return items[items.length - 1];
}

export function pickGpu(os, random = Math.random) {
  const [vendor, renderer] = weighted(GPUS[os] || GPUS.linux, g => g[2], random);
  return { vendor, renderer };
}

export function gpuValidFor(os, gpu) {
  return !!gpu && (GPUS[os] || GPUS.linux).some(([vendor, renderer]) => vendor === gpu.vendor && renderer === gpu.renderer);
}

/** Defaults for a new profile: what a typical desktop of that OS reports. */
export function defaultSettings(os, random = Math.random) {
  return {
    gpu: pickGpu(os, random),
    cores: null, // keep the fingerprint's own value
    mics: 1,
    speakers: 1,
    // Most laptops have a webcam, most desktops don't.
    webcams: random() < 0.55 ? 1 : 0,
    voices: 'auto',
    doNotTrack: false,
    globalPrivacyControl: false,
    webrtc: 'real',
    geoip: true,
    humanize: true,
    drift: true,
  };
}

const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });
const intIn = (value, min, max, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};
const bool = (value, name) => {
  if (typeof value !== 'boolean') throw badRequest(`${name} must be true or false`);
  return value;
};

/** Merge a partial settings object onto `base`, validating each field. */
export function mergeSettings(base, input, os) {
  if (input === undefined || input === null) return { ...base };
  if (typeof input !== 'object' || Array.isArray(input)) throw badRequest('settings must be an object');
  const out = { ...base };
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'gpu':
        if (value === null || value === 'auto') { out.gpu = pickGpu(os); break; }
        if (!gpuValidFor(os, value)) throw badRequest(`gpu must be one of the ${os} GPUs from GET /profiles/options`);
        out.gpu = { vendor: value.vendor, renderer: value.renderer };
        break;
      case 'cores':
        if (value === null || value === 'auto') { out.cores = null; break; }
        if (!CORE_COUNTS.includes(Number(value))) throw badRequest(`cores must be one of ${CORE_COUNTS.join(', ')}`);
        out.cores = Number(value);
        break;
      case 'mics': case 'speakers': out[key] = intIn(value, 0, 4, key); break;
      case 'webcams': out[key] = intIn(value, 0, 2, key); break;
      case 'voices':
        if (!['auto', 'none'].includes(value)) throw badRequest('voices must be "auto" or "none"');
        out.voices = value;
        break;
      case 'webrtc':
        if (!['real', 'block'].includes(value)) throw badRequest('webrtc must be "real" or "block"');
        out.webrtc = value;
        break;
      case 'doNotTrack': case 'globalPrivacyControl': case 'geoip': case 'humanize': case 'drift':
        out[key] = bool(value, key);
        break;
      default:
        throw badRequest(`unknown setting "${key}"`);
    }
  }
  // An OS change can leave a GPU that OS never reports.
  if (!gpuValidFor(os, out.gpu)) out.gpu = pickGpu(os);
  return out;
}

/**
 * Advance the drift state by the time since it was last rolled. Each day
 * carries a small chance of a device change, like plugging in a headset or
 * an external webcam, so a profile looks like one machine used over months.
 */
export function advanceDrift(settings, drift, now, random = Math.random) {
  const state = { mics: 0, speakers: 0, webcams: 0, rolledAt: now, ...drift };
  if (!settings.drift) return { ...state, mics: 0, speakers: 0, webcams: 0, rolledAt: now };
  const days = Math.min(120, Math.floor((now - (drift?.rolledAt ?? now)) / DAY));
  for (let day = 0; day < days; day++) {
    // A headset adds a mic and an output; it gets unplugged again later.
    if (random() < 1 / 40) {
      const plugged = state.speakers > 0;
      state.speakers = plugged ? 0 : 1;
      state.mics = plugged ? 0 : 1;
    }
    if (random() < 1 / 90) state.webcams = state.webcams > 0 ? 0 : 1;
  }
  if (days > 0) state.rolledAt = now;
  return state;
}

/**
 * Window geometry for this launch: usually maximized (what the fingerprint
 * pins), sometimes a restored window, as people do resize. Returns config
 * overrides or {} for maximized.
 */
export function windowForLaunch(fingerprintScreen, os, random = Math.random) {
  const s = fingerprintScreen;
  if (!s?.availWidth || random() >= 0.15) return {};
  const outerWidth = Math.round(s.availWidth * (0.62 + random() * 0.3));
  const outerHeight = Math.round(s.availHeight * (0.7 + random() * 0.25));
  const border = os === 'windows' ? 8 : 0;
  return {
    'window.outerWidth': outerWidth,
    'window.outerHeight': outerHeight,
    'window.innerWidth': outerWidth - border * 2,
    'window.innerHeight': outerHeight - 85 - border,
    'window.screenX': Math.round((s.availWidth - outerWidth) * random()),
    'window.screenY': (s.availTop || 0) + Math.round((s.availHeight - outerHeight) * random()),
  };
}

/** Camoufox launch options for a profile's settings (applied after pinned values). */
export function launchOverrides(settings, { os, locale, drift }) {
  if (!settings) return { config: {} };
  const config = {
    'mediaDevices:enabled': true,
    'mediaDevices:micros': Math.min(4, settings.mics + (drift?.mics || 0)),
    'mediaDevices:speakers': Math.min(4, settings.speakers + (drift?.speakers || 0)),
    'mediaDevices:webcams': Math.min(2, settings.webcams + (drift?.webcams || 0)),
    'navigator.doNotTrack': settings.doNotTrack ? '1' : 'unspecified',
    'navigator.globalPrivacyControl': settings.globalPrivacyControl,
  };
  if (settings.cores) config['navigator.hardwareConcurrency'] = settings.cores;
  if (settings.voices === 'auto') {
    const voices = voicesFor(os, locale || 'en-US');
    if (voices.length) config.voices = voices;
  }
  return {
    config,
    ...(settings.gpu ? { webgl_config: [settings.gpu.vendor, settings.gpu.renderer] } : {}),
    block_webrtc: settings.webrtc === 'block',
    humanize: settings.humanize,
  };
}

/** The choices the dashboard and agents can pick from. */
export function settingsOptions() {
  return {
    gpus: Object.fromEntries(Object.entries(GPUS).map(([os, list]) => [os, list.map(([vendor, renderer]) => ({ vendor, renderer }))])),
    cores: CORE_COUNTS,
    voices: ['auto', 'none'],
    webrtc: ['real', 'block'],
  };
}
