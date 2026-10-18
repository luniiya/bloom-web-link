import { expect, test } from 'bun:test';
import { lifetimeLabel, closureLabel } from '../../src/web-ui/lifetime.ts';

test('shows pinned, viewed, disabled and imminent idle cleanup states', () => {
  expect(lifetimeLabel({ keepOpen: true, protected: true, expiresAt: null, idleTimeoutMs: 300000 })).toContain('Kept open');
  expect(lifetimeLabel({ keepOpen: false, protected: true, expiresAt: null, idleTimeoutMs: 300000 })).toContain('Protected');
  expect(lifetimeLabel({ keepOpen: false, protected: false, expiresAt: null, idleTimeoutMs: 0 })).toContain('disabled');
  expect(lifetimeLabel({ keepOpen: false, protected: false, expiresAt: 31000, idleTimeoutMs: 300000 }, 1000)).toContain('Closes in 30s');
});
test('distinguishes idle closure from browser restart', () => {
  expect(closureLabel('idle_timeout')).toBe('Closed by the idle timer');
  expect(closureLabel('browser_restart:health')).toBe('Closed during a browser restart');
});
