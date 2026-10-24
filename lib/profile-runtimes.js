// One Camoufox process per active profile. Launch, teardown and process
// cleanup are injected so this module stays testable without a browser.

/**
 * @param {object} opts
 * @param {(profile: object) => Promise<{browser: object, virtualDisplay?: object}>} opts.launch
 * @param {(runtime: {browser: object, virtualDisplay?: object}, reason: string) => Promise<void>} opts.close
 * @param {number} opts.maxBrowsers - live profile browsers allowed at once
 * @param {number} opts.idleMs - close a profile browser this long after its last session ends (0 = never)
 * @param {Function} [opts.log]
 */
export function createProfileRuntimes({ launch, close, maxBrowsers, idleMs, log = () => {} }) {
  const runtimes = new Map(); // profileId -> { browser, virtualDisplay, launching, idleTimer, closing }

  function clearIdle(runtime) {
    if (runtime?.idleTimer) {
      clearTimeout(runtime.idleTimer);
      runtime.idleTimer = null;
    }
  }

  async function closeRuntime(profileId, reason) {
    const runtime = runtimes.get(profileId);
    if (!runtime) return false;
    clearIdle(runtime);
    if (runtime.closing) return runtime.closing;
    runtime.closing = (async () => {
      try {
        if (runtime.launching) await runtime.launching.catch(() => {});
        if (runtime.browser) await close(runtime, reason);
      } finally {
        if (runtimes.get(profileId) === runtime) runtimes.delete(profileId);
        log('info', 'profile browser closed', { profileId, reason });
      }
      return true;
    })();
    return runtime.closing;
  }

  async function ensure(profile) {
    let runtime = runtimes.get(profile.id);
    if (runtime?.closing) {
      await runtime.closing;
      runtime = undefined;
    }
    if (runtime?.browser && !runtime.browser.isConnected?.()) {
      log('warn', 'profile browser disconnected; relaunching', { profileId: profile.id });
      await closeRuntime(profile.id, 'browser_disconnected');
      runtime = undefined;
    }
    if (runtime) {
      clearIdle(runtime);
      if (runtime.browser) return runtime.browser;
      return runtime.launching;
    }
    if (runtimes.size >= maxBrowsers) {
      throw Object.assign(
        new Error(`Maximum live profile browsers reached (${maxBrowsers}); close tabs in another profile first`),
        { statusCode: 503, code: 'admission_rejected' },
      );
    }
    runtime = { browser: null, virtualDisplay: null, launching: null, idleTimer: null, closing: null };
    runtimes.set(profile.id, runtime);
    runtime.launching = (async () => {
      try {
        const launched = await launch(profile);
        runtime.browser = launched.browser;
        runtime.virtualDisplay = launched.virtualDisplay || null;
        // A crashed or killed browser frees its slot and reports as stopped.
        runtime.browser.on?.('disconnected', () => {
          if (runtimes.get(profile.id) === runtime && !runtime.closing) {
            log('warn', 'profile browser disconnected', { profileId: profile.id });
            closeRuntime(profile.id, 'browser_disconnected').catch(() => {});
          }
        });
        log('info', 'profile browser launched', { profileId: profile.id, name: profile.name });
        return runtime.browser;
      } catch (err) {
        if (runtimes.get(profile.id) === runtime) runtimes.delete(profile.id);
        throw err;
      } finally {
        runtime.launching = null;
      }
    })();
    return runtime.launching;
  }

  return {
    ensure,
    close: closeRuntime,
    async closeAll(reason) {
      await Promise.all(Array.from(runtimes.keys()).map(id => closeRuntime(id, reason)));
    },
    /** Call whenever a profile's session count may have reached zero. */
    scheduleIdle(profileId, hasSessions) {
      const runtime = runtimes.get(profileId);
      if (!runtime || runtime.closing) return;
      clearIdle(runtime);
      if (hasSessions || !(idleMs > 0)) return;
      runtime.idleTimer = setTimeout(() => {
        runtime.idleTimer = null;
        closeRuntime(profileId, 'idle_shutdown').catch(err => log('warn', 'profile browser idle close failed', { profileId, error: err.message }));
      }, idleMs);
      runtime.idleTimer.unref?.();
    },
    has(profileId) {
      return runtimes.has(profileId);
    },
    /** PIDs of live profile browsers and their Xvfb displays (kept out of default-browser cleanup). */
    ownedPids() {
      const pids = new Set();
      for (const runtime of runtimes.values()) {
        const pid = runtime.browser?.process?.()?.pid;
        if (pid) pids.add(pid);
        const displayPid = runtime.virtualDisplay?.proc?.pid;
        if (displayPid) pids.add(displayPid);
      }
      return pids;
    },
    list() {
      return Array.from(runtimes.entries()).map(([profileId, runtime]) => ({
        profileId,
        running: !!runtime.browser?.isConnected?.(),
        launching: !!runtime.launching,
      }));
    },
  };
}
