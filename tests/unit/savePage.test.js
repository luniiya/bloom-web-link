import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs/promises';
import { saveCurrentPage } from '../../lib/downloads.js';

function fakePage({ url, contentType = 'text/html', title = 'My Page', html = '<html><body>hi</body></html>', response }) {
  const requests = [];
  return {
    requests,
    url: () => url,
    title: async () => title,
    content: async () => html,
    evaluate: async () => contentType,
    context: () => ({ request: { get: async (u) => { requests.push(u); return response; } } }),
  };
}

const response = ({ type, body, disposition, ok = true }) => ({
  ok: () => ok,
  headers: () => ({ 'content-type': type, ...(disposition ? { 'content-disposition': disposition } : {}) }),
  body: async () => Buffer.from(body),
});

describe('saveCurrentPage (Ctrl+S)', () => {
  test('an HTML page is saved as its current DOM, named after the title, without refetching', async () => {
    const tabState = { downloads: [] };
    const page = fakePage({ url: 'https://example.com/a', title: 'Hello / World' });
    const saved = await saveCurrentPage(page, tabState);
    expect(saved).toMatchObject({ mimeType: 'text/html', suggestedFilename: 'Hello _ World.html' });
    expect(page.requests).toHaveLength(0);
    const text = await fs.readFile(tabState.downloads[0].filePath, 'utf8');
    expect(text).toContain('<!-- saved from url=https://example.com/a -->');
    expect(text).toContain('<body>hi</body>');
  });

  test('a PDF tab is saved as the original file through the tab context', async () => {
    const tabState = { downloads: [] };
    const page = fakePage({ url: 'https://example.com/files/report', contentType: 'application/pdf', response: response({ type: 'application/pdf', body: '%PDF-1.7' }) });
    const saved = await saveCurrentPage(page, tabState);
    expect(page.requests).toEqual(['https://example.com/files/report']);
    expect(saved).toMatchObject({ mimeType: 'application/pdf', suggestedFilename: 'report.pdf', bytes: 8 });
    expect(await fs.readFile(tabState.downloads[0].filePath, 'utf8')).toBe('%PDF-1.7');
  });

  test('Content-Disposition names the file', async () => {
    const tabState = { downloads: [] };
    const page = fakePage({ url: 'https://example.com/dl?id=3', contentType: 'text/csv', response: response({ type: 'text/csv; charset=utf-8', body: 'a,b', disposition: 'attachment; filename="sales 2026.csv"' }) });
    expect(await saveCurrentPage(page, tabState)).toMatchObject({ suggestedFilename: 'sales 2026.csv', mimeType: 'text/csv' });
  });

  test('falls back to the DOM when the refetch fails or returns HTML', async () => {
    const tabState = { downloads: [] };
    const page = fakePage({ url: 'https://example.com/x.txt', contentType: 'text/plain', response: response({ type: 'text/html', body: '<html>' }) });
    expect(await saveCurrentPage(page, tabState)).toMatchObject({ mimeType: 'text/html', suggestedFilename: 'My Page.html' });
  });
});
