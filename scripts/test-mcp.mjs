#!/usr/bin/env node
// Self-contained MCP handshake/schema smoke test. It uses the official client
// transport so framing and protocol negotiation stay aligned with the SDK.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SERVER = process.env.CAMOFOX_MCP_SERVER || resolve(ROOT, 'mcp', 'server.mjs');
const EXPECTED_TOOLS = [
  'camofox_create_tab',
  'camofox_snapshot',
  'camofox_click',
  'camofox_wait',
  'camofox_mouse',
  'camofox_type',
  'camofox_navigate',
  'camofox_scroll',
  'camofox_screenshot',
  'camofox_close_tab',
  'camofox_evaluate',
  'camofox_list_tabs',
  'camofox_import_cookies',
];

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name} ${detail}`);
    failures++;
  }
}

async function main() {
  console.log('mcp/server.mjs smoke test');
  const client = new Client({ name: 'camofox-smoke-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: ROOT,
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      USER: process.env.USER || '',
      NODE_OPTIONS: process.env.NODE_OPTIONS || '',
      CAMOFOX_BASE_URL: 'http://localhost:1',
    },
    stderr: 'pipe',
  });

  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk.toString(); });

  try {
    await client.connect(transport);
    check('handshake returns server name', client.getServerVersion()?.name === 'camofox-browser');

    const { tools } = await client.listTools();
    const names = tools.map(tool => tool.name).sort();
    check('lists exactly 13 tools', tools.length === 13, `got ${tools.length}`);
    check('tool names match expected', names.join(',') === [...EXPECTED_TOOLS].sort().join(','), `got: ${names.join(',')}`);

    for (const tool of tools) {
      check(`"${tool.name}" has description`, typeof tool.description === 'string' && tool.description.length > 0);
      check(`"${tool.name}" has inputSchema.object`, tool.inputSchema?.type === 'object' && tool.inputSchema.properties !== undefined);
    }

    const navigate = tools.find(tool => tool.name === 'camofox_navigate');
    const macros = navigate.inputSchema.properties.macro.enum;
    check('navigate exposes google + reddit macros', macros.includes('@google_search') && macros.includes('@reddit_search'));
    check('navigate has >=13 macros', macros.length >= 13, `got ${macros.length}`);

    const unknown = await client.callTool({ name: 'does_not_exist', arguments: {} });
    check('unknown tool returns isError', unknown.isError === true, `got isError=${unknown.isError}`);
    check('unknown tool mentions Unknown tool', /Unknown tool/.test(unknown.content[0].text));
  } catch (err) {
    console.error(`FATAL: ${err.message}${stderr ? `\nstderr:\n${stderr}` : ''}`);
    failures++;
  } finally {
    await transport.close().catch(() => {});
  }

  if (failures > 0) process.exit(1);
  console.log('\nall checks passed');
}

await main();
