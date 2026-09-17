import { dismissConsentDialogs as defaultDismissConsentDialogs } from './consent.js';

/**
 * Build a page-readiness helper with explicit logging and consent behavior.
 * Keeping these dependencies injectable makes the policy independently testable.
 */
export function createPageReady({
  log = () => {},
  dismissConsentDialogs = defaultDismissConsentDialogs,
} = {}) {
  return async function waitForPageReady(page, options = {}) {
    const {
      timeout = 10000,
      waitForNetwork = true,
      waitForHydration = true,
      settleMs = 200,
      hydrationPollMs = 250,
      hydrationTimeoutMs = Math.min(timeout, 10000),
      dismissConsent = false,
    } = options;

    try {
      await page.waitForLoadState('domcontentloaded', { timeout });

      if (waitForNetwork) {
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
          log('warn', 'networkidle timeout, continuing');
        });
      }

      if (waitForHydration) {
        const maxIterations = Math.max(1, Math.floor(hydrationTimeoutMs / hydrationPollMs));
        await page.evaluate(async ({ maxIterations, hydrationPollMs }) => {
          for (let i = 0; i < maxIterations; i++) {
            const entries = performance.getEntriesByType('resource');
            const recentEntries = entries.slice(-5);
            const netQuiet = recentEntries.every(entry => (performance.now() - entry.responseEnd) > 400);

            if (document.readyState === 'complete' && netQuiet) {
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              break;
            }
            await new Promise(resolve => setTimeout(resolve, hydrationPollMs));
          }
        }, { maxIterations, hydrationPollMs }).catch(() => {
          log('warn', 'hydration wait failed, continuing');
        });
      }

      if (settleMs > 0) await page.waitForTimeout(settleMs);
      if (dismissConsent) await dismissConsentDialogs(page, { log });
      return true;
    } catch (err) {
      log('warn', 'page ready failed', { error: err.message });
      return false;
    }
  };
}
