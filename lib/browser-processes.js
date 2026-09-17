export async function killProcessIds(pids, { signal = 'SIGKILL', delayMs = 300 } = {}) {
  for (const pid of pids) {
    try { process.kill(pid, signal); } catch { /* already dead */ }
  }
  if (pids.length > 0 && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
