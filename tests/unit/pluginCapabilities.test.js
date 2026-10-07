import { describe, expect, test } from '@jest/globals';
import { createVirtualDisplayRegistry } from '../../lib/plugin-capabilities.js';

describe('virtual display plugin capability', () => {
  test('uses the registered plugin provider instead of the default provider', () => {
    const registry = createVirtualDisplayRegistry(() => ({ owner: 'core' }));

    registry.register('display-a', () => ({ owner: 'display-a' }));

    expect(registry.owner).toBe('display-a');
    expect(registry.create()).toEqual({ owner: 'display-a' });
  });

  test('rejects a second plugin provider instead of relying on load order', () => {
    const registry = createVirtualDisplayRegistry(() => ({ owner: 'core' }));
    registry.register('display-a', () => ({ owner: 'display-a' }));

    expect(() => registry.register('other-display', () => ({ owner: 'other' }))).toThrow(
      '"display-a" already owns the capability; "other-display" cannot also provide it'
    );
  });
});
