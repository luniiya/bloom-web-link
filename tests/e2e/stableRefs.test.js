import { createClient } from '../helpers/client.js';
import { getSharedEnv } from './sharedEnv.js';

describe('stable dynamic refs', () => {
  test('a ref remains attached to its original control when identical controls reorder', async () => {
    const { serverUrl, testSiteUrl } = getSharedEnv();
    const client = createClient(serverUrl);
    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/reordering-controls`);
      const snapshot = await client.getSnapshot(tabId);
      const choiceRefs = [...snapshot.snapshot.matchAll(/button "Choice" \[(e\d+)\]/g)].map((match) => match[1]);
      expect(choiceRefs).toHaveLength(2);

      // The first visual control is Alpha. It moves after Beta when clicked.
      // Its original ref must still activate Alpha after the ref refresh.
      await client.click(tabId, { ref: choiceRefs[0] });
      await client.click(tabId, { ref: choiceRefs[0] });
      expect(await client.evaluate(tabId, "document.querySelector('#result').textContent")).toMatchObject({ result: 'alpha' });
    } finally {
      await client.cleanup();
    }
  });

  test('drag accepts stable source and target refs', async () => {
    const { serverUrl, testSiteUrl } = getSharedEnv();
    const client = createClient(serverUrl);
    try {
      const { tabId } = await client.createTab(`${testSiteUrl}/drag-targets`);
      const snapshot = await client.getSnapshot(tabId);
      const sourceRef = snapshot.snapshot.match(/button "Drag Alpha" \[(e\d+)\]/)?.[1];
      const targetRef = snapshot.snapshot.match(/button "Drop Zone" \[(e\d+)\]/)?.[1];
      expect(sourceRef).toBeTruthy();
      expect(targetRef).toBeTruthy();

      await client.request('POST', `/tabs/${tabId}/mouse`, {
        userId: client.userId,
        action: 'drag',
        sourceRef,
        targetRef,
        steps: 20,
      });
      expect(await client.evaluate(tabId, "document.querySelector('#result').textContent")).toMatchObject({ result: 'alpha' });
    } finally {
      await client.cleanup();
    }
  });
});
