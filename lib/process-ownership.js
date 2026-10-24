import fs from 'fs';
import path from 'path';

const BROWSER_PROCESS_RE = /camoufox-bin|\/usr\/bin\/Xvfb\b/;
// Set in each profile browser's environment and inherited by its content
// processes. Playwright's Browser exposes no PID, so this is how the default
// browser's cleanup tells profile browsers apart from its own survivors.
export const PROFILE_ENV_KEY = 'BWL_PROFILE_ID';

function readProcess(procRoot, pid) {
  const status = fs.readFileSync(`${procRoot}/${pid}/status`, 'utf8');
  const ppid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
  // The comm field is parenthesized and may itself contain spaces or `)`, so
  // fields cannot be found with a plain whitespace split. starttime is field
  // 22 overall, or index 19 in the suffix beginning with field 3 (state).
  const stat = fs.readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
  const commEnd = stat.lastIndexOf(')');
  if (commEnd < 0) throw new Error(`invalid proc stat for ${pid}`);
  const startTime = stat.slice(commEnd + 2).trim().split(/\s+/)[19];
  if (startTime === undefined) throw new Error(`missing starttime for ${pid}`);
  const cmdline = fs.readFileSync(`${procRoot}/${pid}/cmdline`, 'utf8');
  return { pid: Number(pid), ppid, startTime, cmdline };
}

function readProfileTag(procRoot, pid) {
  try {
    const entry = fs.readFileSync(`${procRoot}/${pid}/environ`, 'utf8').split('\0').find(e => e.startsWith(`${PROFILE_ENV_KEY}=`));
    return entry ? entry.slice(PROFILE_ENV_KEY.length + 1) : null;
  } catch { return null; }
}

/** Snapshot browser/Xvfb descendants owned by one server process. */
export function snapshotOwnedBrowserProcesses(rootPid, procRoot = '/proc') {
  if (process.platform !== 'linux' && procRoot === '/proc') return [];
  const processes = [];
  for (const entry of fs.readdirSync(procRoot)) {
    if (!/^\d+$/.test(entry)) continue;
    try { processes.push(readProcess(procRoot, entry)); } catch { /* process vanished */ }
  }

  const descendants = new Set([Number(rootPid)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const proc of processes) {
      if (!descendants.has(proc.pid) && descendants.has(proc.ppid)) {
        descendants.add(proc.pid);
        changed = true;
      }
    }
  }
  return processes
    .filter(proc => descendants.has(proc.pid) && BROWSER_PROCESS_RE.test(proc.cmdline))
    .map(proc => ({ ...proc, profileId: readProfileTag(procRoot, proc.pid) }));
}

export function profilePathsFromProcessSnapshot(snapshot) {
  const profiles = new Set();
  for (const { cmdline = '' } of snapshot) {
    const args = cmdline.split('\0');
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      let profile;
      if (arg === '-profile' || arg === '--profile') profile = args[index + 1];
      else if (arg.startsWith('-profile=') || arg.startsWith('--profile=')) profile = arg.slice(arg.indexOf('=') + 1);
      if (profile) profiles.add(path.resolve(profile));
    }
  }
  return profiles;
}

/** Return only snapshot members that are still the same OS processes. */
export function survivingOwnedBrowserProcesses(snapshot, procRoot = '/proc') {
  return snapshot.filter(proc => {
    try { return readProcess(procRoot, proc.pid).startTime === proc.startTime; } catch { return false; }
  });
}

/** Drop snapshot members that are, or descend from, one of rootPids (e.g. live profile browsers). */
export function excludeProcessTrees(snapshot, rootPids) {
  const excluded = new Set([...rootPids].map(Number));
  if (excluded.size === 0) return snapshot;
  let changed = true;
  while (changed) {
    changed = false;
    for (const proc of snapshot) {
      if (!excluded.has(proc.pid) && excluded.has(proc.ppid)) {
        excluded.add(proc.pid);
        changed = true;
      }
    }
  }
  return snapshot.filter(proc => !excluded.has(proc.pid));
}

/** The default browser's processes: drop tagged profile browsers and the given trees (profile Xvfb displays). */
export function excludeProfileBrowsers(snapshot, rootPids = new Set()) {
  return excludeProcessTrees(snapshot.filter(proc => !proc.profileId), rootPids);
}

/** Total resident memory of the snapshot's processes, in MB. */
export function snapshotRssMb(snapshot, procRoot = '/proc') {
  let kb = 0;
  for (const { pid } of snapshot) {
    try { kb += Number(fs.readFileSync(`${procRoot}/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] || 0); } catch { /* exited */ }
  }
  return Math.round(kb / 1024);
}
