/**
 * Download capture and DOM image extraction for bloom-web-link.
 *
 * Handles Playwright download events, temp file lifecycle, and
 * in-page image source extraction with optional inline data.
 */

import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'node:fs/promises';

const MAX_DOWNLOAD_RECORDS_PER_TAB = 20;
const MAX_DOWNLOAD_INLINE_BYTES = 20 * 1024 * 1024;
const MAX_FETCHED_RESOURCE_BYTES = 50 * 1024 * 1024;

function sanitizeFilename(value) {
  return String(value || 'download.bin')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .trim()
    .slice(0, 200) || 'download.bin';
}

function guessMimeTypeFromName(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function removeDownloadFileIfPresent(record) {
  const filePath = record?.filePath;
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
}

async function trimTabDownloads(tabState) {
  while (tabState.downloads.length > MAX_DOWNLOAD_RECORDS_PER_TAB) {
    const stale = tabState.downloads.shift();
    await removeDownloadFileIfPresent(stale);
  }
}

async function clearTabDownloads(tabState) {
  const entries = Array.isArray(tabState.downloads) ? [...tabState.downloads] : [];
  tabState.downloads = [];
  await Promise.all(entries.map(removeDownloadFileIfPresent));
}

async function clearSessionDownloads(session) {
  if (!session || !session.tabGroups) return;
  const tasks = [];
  for (const group of session.tabGroups.values()) {
    for (const tabState of group.values()) {
      tasks.push(clearTabDownloads(tabState));
    }
  }
  await Promise.all(tasks);
}

function downloadEventOccurredSince(tabState, sequence) {
  return (tabState.downloadEventSequence || 0) > sequence;
}

async function clickWithDownloadGuard(tabState, click) {
  const downloadSequence = tabState.downloadEventSequence || 0;
  try {
    return await click();
  } catch (err) {
    if (downloadEventOccurredSince(tabState, downloadSequence)) return;
    throw err;
  }
}

function attachDownloadListener(tabState, tabId, log, pluginEvents, userId) {
  if (tabState.downloadListenerAttached) return;
  tabState.downloadListenerAttached = true;

  tabState.page.on('download', async (download) => {
    tabState.downloadEventSequence = (tabState.downloadEventSequence || 0) + 1;
    const downloadId = crypto.randomUUID();
    const suggestedFilename = sanitizeFilename(download.suggestedFilename?.() || `download-${downloadId}.bin`);
    const filePath = path.join(os.tmpdir(), `bwl-download-${downloadId}-${suggestedFilename}`);

    const url = String(download.url?.() || '').trim();
    if (pluginEvents) {
      pluginEvents.emit('tab:download:start', { userId: userId || null, tabId, filename: suggestedFilename, url });
    }

    let failure = null;
    let bytes = null;

    try {
      await download.saveAs(filePath);
      const stat = await fs.stat(filePath);
      bytes = stat.size;
    } catch (err) {
      failure = String(err?.message || err || 'download_save_failed');
      await fs.unlink(filePath).catch(() => {});
    }

    const reportedFailure = await download.failure().catch(() => null);
    if (reportedFailure) {
      failure = reportedFailure;
    }

    if (url) {
      tabState.visitedUrls.add(url);
    }

    const mimeType = guessMimeTypeFromName(suggestedFilename) || guessMimeTypeFromName(url);
    tabState.downloads.push({
      id: downloadId,
      tabId,
      url,
      suggestedFilename,
      mimeType,
      bytes,
      createdAt: new Date().toISOString(),
      filePath: failure ? null : filePath,
      failure,
    });

    if (pluginEvents && !failure) {
      pluginEvents.emit('tab:download:complete', { userId: userId || null, tabId, filename: suggestedFilename, path: filePath, size: bytes });
    }

    await trimTabDownloads(tabState);
    log('info', 'download captured', {
      tabId, downloadId, suggestedFilename, mimeType, bytes,
      hasUrl: Boolean(url), failure,
    });
  });
}

async function captureFetchedResource(tabState, { url, mimeType, filename, body }) {
  if (!Buffer.isBuffer(body)) throw new Error('Fetched resource body must be bytes');
  if (body.length > MAX_FETCHED_RESOURCE_BYTES) throw new Error(`Fetched resource exceeds ${MAX_FETCHED_RESOURCE_BYTES} byte limit`);
  const downloadId = crypto.randomUUID();
  const suggestedFilename = sanitizeFilename(filename || `resource-${downloadId}`);
  const filePath = path.join(os.tmpdir(), `bwl-download-${downloadId}-${suggestedFilename}`);
  await fs.writeFile(filePath, body);
  tabState.downloads.push({
    id: downloadId, tabId: null, url, suggestedFilename,
    mimeType: mimeType || guessMimeTypeFromName(suggestedFilename), bytes: body.length,
    createdAt: new Date().toISOString(), filePath, failure: null,
  });
  await trimTabDownloads(tabState);
  return { id: downloadId, url, suggestedFilename, mimeType: mimeType || guessMimeTypeFromName(suggestedFilename), bytes: body.length };
}

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const EXTENSION_BY_MIME = {
  'application/pdf': '.pdf', 'application/json': '.json', 'application/xml': '.xml', 'text/xml': '.xml',
  'text/plain': '.txt', 'text/csv': '.csv', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/svg+xml': '.svg',
};

function filenameFromDisposition(header) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(String(header || ''));
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function withExtension(name, mimeType) {
  const ext = EXTENSION_BY_MIME[mimeType];
  return !ext || /\.[a-z0-9]{1,8}$/i.test(name) ? name : `${name}${ext}`;
}

/**
 * Ctrl+S for a tab. A document (PDF, image, CSV, ...) is saved as its original
 * bytes, fetched through the tab's context so its cookies apply; an HTML page
 * is saved as its current DOM. The file joins the tab's downloads.
 */
async function saveCurrentPage(page, tabState) {
  const url = page.url();
  // The document's own type, without a network round trip (pdf.js reports application/pdf).
  const docType = String(await page.evaluate(() => document.contentType).catch(() => 'text/html')).toLowerCase();
  if (!HTML_TYPES.has(docType) && /^https?:\/\//i.test(url)) {
    const response = await page.context().request.get(url, { timeout: 30000 });
    const headers = response.headers();
    const mimeType = String(headers['content-type'] || docType).split(';', 1)[0].trim().toLowerCase();
    if (response.ok() && !HTML_TYPES.has(mimeType)) {
      const declared = Number(headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_FETCHED_RESOURCE_BYTES) {
        throw Object.assign(new Error(`Document exceeds ${MAX_FETCHED_RESOURCE_BYTES} byte limit`), { statusCode: 413 });
      }
      const body = await response.body();
      if (body.length > MAX_FETCHED_RESOURCE_BYTES) {
        throw Object.assign(new Error(`Document exceeds ${MAX_FETCHED_RESOURCE_BYTES} byte limit`), { statusCode: 413 });
      }
      const fromUrl = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      const filename = withExtension(filenameFromDisposition(headers['content-disposition']) || fromUrl || 'document', mimeType);
      return captureFetchedResource(tabState, { url, mimeType, filename, body });
    }
  }
  const title = (await page.title().catch(() => '')).trim();
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  const html = `<!-- saved from url=${url} -->\n${await page.content()}`;
  return captureFetchedResource(tabState, {
    url,
    mimeType: 'text/html',
    filename: `${(title || host || 'page').slice(0, 120)}.html`,
    body: Buffer.from(html, 'utf8'),
  });
}

/**
 * Build the response array for GET /tabs/:tabId/downloads.
 */
async function getDownloadsList(tabState, { includeData = false, maxBytes = MAX_DOWNLOAD_INLINE_BYTES } = {}) {
  const snapshot = Array.isArray(tabState.downloads) ? [...tabState.downloads] : [];
  const downloads = [];

  for (const entry of snapshot) {
    const item = {
      id: entry.id,
      url: entry.url,
      suggestedFilename: entry.suggestedFilename,
      mimeType: entry.mimeType,
      bytes: entry.bytes,
      createdAt: entry.createdAt,
      failure: entry.failure,
    };

    if (includeData && entry.filePath && !entry.failure) {
      if (typeof entry.bytes === 'number' && entry.bytes > maxBytes) {
        item.dataSkipped = 'max_bytes_exceeded';
      } else {
        try {
          const raw = await fs.readFile(entry.filePath);
          item.dataBase64 = raw.toString('base64');
        } catch (err) {
          item.readError = String(err?.message || err || 'download_read_failed');
        }
      }
    }

    downloads.push(item);
  }

  return downloads;
}

export {
  saveCurrentPage,
  MAX_DOWNLOAD_INLINE_BYTES,
  MAX_FETCHED_RESOURCE_BYTES,
  sanitizeFilename,
  guessMimeTypeFromName,
  clearTabDownloads,
  clearSessionDownloads,
  attachDownloadListener,
  clickWithDownloadGuard,
  captureFetchedResource,
  downloadEventOccurredSince,
  getDownloadsList,
};
