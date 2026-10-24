/**
 * OpenAPI spec generation via swagger-jsdoc + docs UI (swagger-stripey).
 *
 * swagger-jsdoc scans JSDoc `@openapi` comments on route handlers in server.js
 * (and any file passed in `apis`) to build the spec at startup.
 * Docs UI lives in docs/api.html (swagger-stripey: Stripe-style 3-panel renderer).
 *
 * Usage:
 *   import { mountDocs } from './lib/openapi.js';
 *   // After all routes are registered:
 *   mountDocs(app);
 */

import swaggerJsdoc from 'swagger-jsdoc';
import express from 'express';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let version = 'unknown';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  version = pkg.version;
} catch { /* ignore */ }

const swaggerDefinition = {
  openapi: '3.0.3',
  info: {
    title: 'bloom-web-link',
    version,
    description:
      'Anti-detection browser automation server for AI agents. ' +
      'Accessibility snapshots, element refs, session isolation, cookie import, proxy rotation, and structured logs.',
    license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    contact: { name: 'Luniiya', url: 'https://github.com/luniiya/bloom-web-link' },
  },
  servers: [{ url: 'http://localhost:9377', description: 'Local development' }],
  tags: [
    { name: 'System', description: 'Server health, metrics, and status.' },
    { name: 'Tabs', description: 'Create, list, inspect, and destroy browser tabs.' },
    { name: 'Navigation', description: 'Navigate tabs to URLs or via search macros.' },
    { name: 'Interaction', description: 'Click, type, scroll, press keys, evaluate JS.' },
    { name: 'Content', description: 'Accessibility snapshots, screenshots, links, images, downloads.' },
    { name: 'Sessions', description: 'Per-user session state: cookies, teardown.' },
    { name: 'Profiles', description: 'Global browser profiles with their own fingerprint, cookies and history.' },
    { name: 'Browser', description: 'Global browser lifecycle (start/stop).' },
    { name: 'Legacy', description: 'OpenClaw-compatible endpoints (deprecated).' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Bearer token matching BWL_API_KEY (per-route auth for sensitive endpoints like cookie import and traces).',
      },
      AccessKeyAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Bearer token matching BWL_ACCESS_KEY. When set, gates all routes except /health, cookie import, and /stop. Acts as a superkey -- also accepted by endpoints that normally require BWL_API_KEY.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' } },
      },
      Profile: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['named', 'burner'] },
          createdAt: { type: 'number' },
          lastUsedAt: { type: 'number' },
          userAgent: { type: 'string', nullable: true },
          screen: { type: 'object', nullable: true, properties: { width: { type: 'number' }, height: { type: 'number' } } },
          userId: { type: 'string', description: 'Core session id of the profile (profile:<id>)' },
          os: { type: 'string', nullable: true, enum: ['windows', 'macos', 'linux'] },
          locale: { type: 'string', nullable: true },
          timezone: { type: 'string', nullable: true },
          settings: { $ref: '#/components/schemas/ProfileSettings' },
          browserRunning: { type: 'boolean' },
          tabs: { type: 'integer' },
        },
      },
      ProfileSettings: {
        type: 'object',
        description: 'Per-profile browser settings. Omitted fields keep their current (or default) value.',
        properties: {
          gpu: { type: 'object', nullable: true, description: 'WebGL vendor/renderer from GET /profiles/options; null picks a common one', properties: { vendor: { type: 'string' }, renderer: { type: 'string' } } },
          cores: { type: 'integer', nullable: true, description: 'navigator.hardwareConcurrency; null keeps the fingerprint value' },
          mics: { type: 'integer', minimum: 0, maximum: 4 },
          speakers: { type: 'integer', minimum: 0, maximum: 4 },
          webcams: { type: 'integer', minimum: 0, maximum: 2 },
          voices: { type: 'string', enum: ['auto', 'none'], description: 'auto lists the speech voices that OS ships' },
          doNotTrack: { type: 'boolean' },
          globalPrivacyControl: { type: 'boolean' },
          webrtc: { type: 'string', enum: ['real', 'block'] },
          geoip: { type: 'boolean', description: 'Timezone and geolocation from the public IP' },
          humanize: { type: 'boolean', description: 'Human-like cursor movement' },
          drift: { type: 'boolean', description: 'Slow, realistic changes over time (devices plugged in, window not always maximized)' },
        },
      },
    },
  },
};

/**
 * Mount GET /openapi.json and GET /docs on the Express app.
 * Call AFTER all routes are registered so swagger-jsdoc can scan them.
 *
 * @param {import('express').Application} app
 * @param {Object} [opts]
 * @param {string[]} [opts.apis] - Glob patterns for files with @openapi JSDoc (default: ['./server.js'])
 */
export function mountDocs(app, opts = {}) {
  const apis = opts.apis || ['./server.js'];

  const spec = swaggerJsdoc({
    definition: swaggerDefinition,
    apis,
  });

  app.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });

  // Serve docs static assets (api.html, fox.png, openapi.json)
  const docsDir = join(__dirname, '..', 'docs');
  app.use('/docs', express.static(docsDir, { index: 'api.html' }));

  // Also serve fox.png at root for backward compat with old Swagger UI HTML
  app.get('/fox.png', (_req, res) => {
    res.sendFile(join(docsDir, 'fox.png'));
  });

  return spec;
}

export { swaggerDefinition };
