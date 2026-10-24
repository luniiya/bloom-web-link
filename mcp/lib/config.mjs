import os from 'node:os';
import { join } from 'node:path';

/**
 * Load only the environment settings the standalone MCP adapter requires.
 * This module intentionally does not import the core server configuration so
 * @luniiya/bloom-web-link-mcp can run without the core package installed.
 */
export function loadMcpConfig() {
  return {
    port: parseInt(process.env.BWL_PORT || process.env.PORT || '9377', 10),
    apiKey: process.env.BWL_API_KEY || '',
    accessKey: (process.env.BWL_ACCESS_KEY || '').trim(),
    cookiesDir: process.env.BWL_COOKIES_DIR || join(os.homedir(), '.bwl', 'cookies'),
  };
}
