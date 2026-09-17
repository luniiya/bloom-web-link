import { clickWithDownloadGuard } from './downloads.js';
import { visibleSelectorCandidate } from './visible-selector.js';

async function dispatchMouseSequence({ page, locator, doubleClick, remainingBudget, withTimeout, log }) {
  const bboxTimeout = Math.max(500, Math.min(3000, remainingBudget()));
  let box;
  try {
    box = await locator.boundingBox({ timeout: bboxTimeout });
  } catch {
    const err = new Error(`Element not actionable: no bounding box within ${bboxTimeout}ms (element likely detached after page change). Call snapshot to refresh refs and retry.`);
    err.statusCode = 422;
    throw err;
  }
  if (!box) throw new Error('Element not visible (no bounding box)');

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await withTimeout(page.mouse.move(x, y), Math.max(1, remainingBudget()), 'native mouse move');
  await page.waitForTimeout(50);

  const clickCount = doubleClick ? 2 : 1;
  for (let index = 0; index < clickCount; index++) {
    await withTimeout(page.mouse.down(), Math.max(1, remainingBudget()), 'native mouse down');
    await page.waitForTimeout(50);
    await withTimeout(page.mouse.up(), Math.max(1, remainingBudget()), 'native mouse up');
    if (index + 1 < clickCount) await page.waitForTimeout(75);
  }
  log('info', 'mouse sequence dispatched', { x: x.toFixed(0), y: y.toFixed(0) });
}

/** Click an element with bounded native-pointer fallbacks. */
export async function clickLocator({
  tabState,
  locatorOrSelector,
  isLocator,
  doubleClick = false,
  forceFirst = false,
  remainingBudget,
  withTimeout,
  log = () => {},
}) {
  const { page } = tabState;
  let locator = isLocator ? locatorOrSelector : page.locator(locatorOrSelector);
  const visibleSelector = isLocator ? null : visibleSelectorCandidate(locatorOrSelector);
  if (visibleSelector) {
    const visibleLocator = page.locator(visibleSelector);
    if (await visibleLocator.count() === 1) {
      locator = visibleLocator;
      log('info', 'click constrained selector to visible match', { selector: locatorOrSelector });
    }
  }

  const click = options => clickWithDownloadGuard(tabState, () => locator.click(options));
  const clickOptions = doubleClick ? { clickCount: 2 } : {};
  const nativeFallback = () => dispatchMouseSequence({
    page, locator, doubleClick, remainingBudget, withTimeout, log,
  });

  if (forceFirst) {
    try {
      await click({ timeout: 3000, force: true, ...clickOptions });
    } catch {
      log('warn', 'force click failed, trying mouse sequence');
      await nativeFallback();
    }
    return;
  }

  try {
    await click({ timeout: 3000, ...clickOptions });
  } catch (err) {
    if (err.message.includes('intercepts pointer events')) {
      log('warn', 'click intercepted, retrying with force');
      try {
        await click({ timeout: 3000, force: true, ...clickOptions });
      } catch {
        log('warn', 'force click failed, trying mouse sequence');
        await nativeFallback();
      }
    } else if (err.message.includes('not visible') || err.message.toLowerCase().includes('timeout')) {
      log('warn', 'click timeout, trying mouse sequence');
      await nativeFallback();
    } else {
      throw err;
    }
  }
}
