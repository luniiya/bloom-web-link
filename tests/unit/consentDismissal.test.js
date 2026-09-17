import { describe, expect, jest, test } from '@jest/globals';
import { COOKIE_BANNER_FIREFOX_PREFS, dismissConsentDialogs } from '../../lib/consent.js';
import { createPageReady } from '../../lib/page-ready.js';

describe('consent handling', () => {
  test('uses Firefox reject-only mode in normal and private contexts', () => {
    expect(COOKIE_BANNER_FIREFOX_PREFS['cookiebanners.service.mode']).toBe(1);
    expect(COOKIE_BANNER_FIREFOX_PREFS['cookiebanners.service.mode.privateBrowsing']).toBe(1);
    expect(COOKIE_BANNER_FIREFOX_PREFS['cookiebanners.service.enableGlobalRules']).toBe(true);
  });

  test('fallback never targets accept-all or generic dialogs', async () => {
    const selectors = [];
    const page = {
      locator(selector) {
        selectors.push(selector);
        return { first: () => ({ isVisible: async () => false }) };
      },
    };

    await dismissConsentDialogs(page);
    expect(selectors.join(' ')).not.toMatch(/accept|allowall|dialog button|modal|overlay/i);
    expect(selectors).toContain('#onetrust-banner-sdk #onetrust-reject-all-handler');
  });

  test('page readiness only runs DOM fallback when explicitly requested', async () => {
    const dismiss = jest.fn(async () => false);
    const page = {
      waitForLoadState: jest.fn(async () => {}),
      evaluate: jest.fn(async () => {}),
      waitForTimeout: jest.fn(async () => {}),
    };
    const waitForPageReady = createPageReady({ dismissConsentDialogs: dismiss });

    await waitForPageReady(page, { waitForNetwork: false, waitForHydration: false, settleMs: 0 });
    expect(dismiss).not.toHaveBeenCalled();

    await waitForPageReady(page, { waitForNetwork: false, waitForHydration: false, settleMs: 0, dismissConsent: true });
    expect(dismiss).toHaveBeenCalledWith(page, { log: expect.any(Function) });
  });
});
