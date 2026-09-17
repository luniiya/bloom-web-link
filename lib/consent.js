/**
 * Firefox-native and DOM fallback handling for cookie consent banners.
 *
 * Mode 1 rejects consent where Firefox has a matching rule and otherwise
 * leaves the banner alone. It never falls back to accepting all cookies.
 */
export const COOKIE_BANNER_FIREFOX_PREFS = Object.freeze({
  'cookiebanners.service.mode': 1,
  'cookiebanners.service.mode.privateBrowsing': 1,
  'cookiebanners.service.enableGlobalRules': true,
  'cookiebanners.service.enableGlobalRules.subFrames': true,
  'cookiebanners.cookieInjector.enabled': true,
});

const DISMISS_SELECTORS = Object.freeze([
  '#onetrust-banner-sdk #onetrust-reject-all-handler',
  '#onetrust-banner-sdk #onetrust-close-btn-container button',
  '#CybotCookiebotDialogBodyButtonDecline',
  '#qc-cmp2-ui button[mode="secondary"]',
]);

/**
 * Reject or close one recognized consent manager. This intentionally avoids
 * generic dialog/modal selectors and accept-all controls.
 */
export async function dismissConsentDialogs(page, { log = () => {} } = {}) {
  for (const selector of DISMISS_SELECTORS) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 100 })) {
        await button.click({ timeout: 1000 }).catch(() => {});
        log('info', 'dismissed consent dialog', { selector });
        await page.waitForTimeout(300);
        return true;
      }
    } catch {
      // Missing, detached, or non-clickable controls are normal here.
    }
  }
  return false;
}
