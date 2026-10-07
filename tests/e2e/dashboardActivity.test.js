import { createClient } from '../helpers/client.js';
import { getSharedEnv } from './sharedEnv.js';

async function listTabIds(client) {
  const { tabs } = await client.request('GET', `/tabs?userId=${encodeURIComponent(client.userId)}`);
  return tabs.map((tab) => tab.tabId);
}

async function activity(serverUrl, tabId, since = 0) {
  const response = await fetch(`${serverUrl}/dashboard/tabs/${encodeURIComponent(tabId)}/activity?since=${since}`);
  expect(response.ok).toBe(true);
  return (await response.json()).entries;
}

describe('failed tab creation', () => {
  test('a rejected URL does not leave a stuck tab behind', async () => {
    const { serverUrl } = getSharedEnv();
    const client = createClient(serverUrl);
    try {
      await client.createTab(); // the session must exist for the leak to be observable
      const before = await listTabIds(client);
      await expect(client.createTab('file:///etc/passwd', { retries: 0 })).rejects.toMatchObject({ status: 400 });
      expect(await listTabIds(client)).toEqual(before);
    } finally {
      await client.cleanup();
    }
  });

  test('a navigation failure does not leave a stuck tab behind', async () => {
    const { serverUrl } = getSharedEnv();
    const client = createClient(serverUrl);
    try {
      await client.createTab();
      const before = await listTabIds(client);
      // Nothing listens on port 9, so navigation fails fast.
      await expect(client.createTab('http://127.0.0.1:9/', { retries: 0 })).rejects.toBeDefined();
      expect(await listTabIds(client)).toEqual(before);
    } finally {
      await client.cleanup();
    }
  });
});

describe('tab activity log', () => {
  test('records agent calls in order with action, detail, status, and source', async () => {
    const { serverUrl, testSiteUrl } = getSharedEnv();
    const client = createClient(serverUrl);
    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/`);
      await client.request('POST', `/tabs/${tabId}/press`, { userId: client.userId, key: 'Tab' });
      await client.request('POST', `/tabs/${tabId}/click`, { userId: client.userId, selector: 'body' });

      const entries = await activity(serverUrl, tabId);
      expect(entries.map((e) => e.action)).toEqual(['create_tab', 'press', 'click']);
      expect(entries[0].detail).toBe(`${testSiteUrl}/`);
      expect(entries[1]).toMatchObject({ detail: 'Tab', status: 200, source: 'agent' });
      expect(entries[2].detail).toBe('body');
      expect(typeof entries[2].ms).toBe('number');

      const newer = await activity(serverUrl, tabId, entries[1].seq);
      expect(newer.map((e) => e.action)).toEqual(['click']);
    } finally {
      await client.cleanup();
    }
  });

  test('labels dashboard calls and skips its screenshot polling', async () => {
    const { serverUrl, testSiteUrl } = getSharedEnv();
    const client = createClient(serverUrl);
    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/`);
      const dashboard = { 'Content-Type': 'application/json', 'X-BWL-Source': 'dashboard' };
      await fetch(`${serverUrl}/tabs/${tabId}/screenshot?userId=${client.userId}`, { headers: dashboard });
      await fetch(`${serverUrl}/tabs/${tabId}/press`, {
        method: 'POST', headers: dashboard, body: JSON.stringify({ userId: client.userId, key: 'Escape' }),
      });

      const entries = await activity(serverUrl, tabId);
      expect(entries.map((e) => e.action)).toEqual(['create_tab', 'press']);
      expect(entries[1].source).toBe('dashboard');
    } finally {
      await client.cleanup();
    }
  });

  test('records failed calls with their error status', async () => {
    const { serverUrl, testSiteUrl } = getSharedEnv();
    const client = createClient(serverUrl);
    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/`);
      await client.request('POST', `/tabs/${tabId}/type`, { userId: client.userId, text: 'x', mode: 'nope' }).catch(() => {});
      const entries = await activity(serverUrl, tabId);
      expect(entries.at(-1)).toMatchObject({ action: 'type', status: 400 });
    } finally {
      await client.cleanup();
    }
  });
});
