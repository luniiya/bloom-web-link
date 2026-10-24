/**
 * Firefox addons that aren't part of camoufox-js's own default set (currently
 * just uBlock Origin) but that we still want installed on every launch by
 * default. Downloaded once per addon into a persistent cache dir under
 * ~/.bwl (same volume the compose.yaml data volume already covers), then
 * reused on every subsequent launch.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';

export const EXTRA_ADDONS = Object.freeze({
  // "I still don't care about cookies" — auto-dismisses/auto-answers cookie
  // consent banners across a much broader set of sites than our own
  // DISMISS_SELECTORS fallback in lib/consent.js.
  IDCAC: 'https://addons.mozilla.org/firefox/downloads/latest/i-dont-care-about-cookies/latest.xpi',
});

export const EXTRA_ADDON_NAMES = Object.freeze(Object.keys(EXTRA_ADDONS));

function cacheRoot() {
  return path.join(process.env.BWL_HOME_DIR || path.join(os.homedir(), '.bwl'), 'addons');
}

function addonDir(name) {
  return path.join(cacheRoot(), name);
}

async function downloadAndExtract(url, destDir, log) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`addon download failed: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  // Extract beside the final dir and rename into place, so a concurrent
  // launch never sees a half-extracted addon.
  const tempDir = `${destDir}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    new AdmZip(buffer).extractAllTo(tempDir, true);
    if (!fs.existsSync(path.join(tempDir, 'manifest.json'))) {
      throw new Error('extracted addon is missing manifest.json');
    }
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.renameSync(tempDir, destDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  log('info', 'extra addon installed', { destDir });
}

// One download per addon at a time: the default and profile browsers can
// launch together.
const installing = new Map();
function installOnce(name, url, dir, log) {
  if (!installing.has(name)) {
    installing.set(name, downloadAndExtract(url, dir, log).finally(() => installing.delete(name)));
  }
  return installing.get(name);
}

/**
 * Resolves local extracted-addon directories for every extra addon not in
 * `exclude`, downloading + extracting any that aren't already cached.
 * Never throws: a failed addon is skipped and logged, launch proceeds.
 */
export async function resolveExtraAddons({ exclude = [], log = () => {} } = {}) {
  const paths = [];
  for (const [name, url] of Object.entries(EXTRA_ADDONS)) {
    if (exclude.includes(name)) continue;
    const dir = addonDir(name);
    if (fs.existsSync(path.join(dir, 'manifest.json'))) {
      paths.push(dir);
      continue;
    }
    try {
      await installOnce(name, url, dir, log);
      paths.push(dir);
    } catch (err) {
      log('warn', 'failed to install extra addon', { name, error: err.message });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return paths;
}
