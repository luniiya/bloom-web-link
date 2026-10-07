# bloom-web-link stdio MCP adapter

**Most clients don't need this.** The bwl container serves MCP directly over Streamable HTTP at `http://localhost:9377/mcp` (see the [main README](../README.md#connect-an-agent)).

This package is a thin **stdio** adapter for MCP hosts that can only launch a local command. It turns each MCP tool call into a REST call against a running bwl container. It depends only on `@modelcontextprotocol/sdk`; no browser and no core server code.

## Setup

1. Start bwl: `docker compose up -d --build` from the repo root.
2. Install the adapter so `bloom-web-link-mcp` is on your `PATH`:

   ```bash
   cd mcp && npm install && npm link
   ```

3. Register it with your host. For Claude Code:

   ```bash
   claude mcp add bloom-web-link -s user -- bloom-web-link-mcp
   ```

   Other hosts (Cursor, Codex, opencode, etc.) take the same command in their MCP config:

   ```json
   { "mcpServers": { "bloom-web-link": { "command": "bloom-web-link-mcp" } } }
   ```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `BWL_BASE_URL` | `http://localhost:9377` | Where the bwl container is listening |
| `BWL_USER_ID` | `mcp-<random>` | Browser session identity. Set a fixed value to resume the same tabs and storage across runs. Agents that share it must coordinate. |
| `BWL_SESSION_KEY` | `default` | Tab group within the user |
| `BWL_ACCESS_KEY` | _unset_ | Sent as `Authorization: Bearer` on every call; must match the container's `BWL_ACCESS_KEY` |
| `BWL_API_KEY` | _unset_ | Needed for `bwl_import_cookies`; must match the container's `BWL_API_KEY` |

## Tools

The adapter exposes the same 17 `bwl_*` tools as the HTTP endpoint (listed in the [main README](../README.md#tools)). Tool names, schemas, and REST routes are defined once in [`lib/tool-contracts.mjs`](lib/tool-contracts.mjs). The HTTP endpoint and the OpenClaw plugin use the same definitions, so the three can't drift apart.

## Troubleshooting

- **`401` on every call:** the container has `BWL_ACCESS_KEY` set. Set the same value in the adapter's env.
- **`403` on `bwl_import_cookies`:** `BWL_API_KEY` is missing or doesn't match the container.
- **`422 strict mode violation`:** a CSS selector matched several elements. Take a new snapshot and use the element ref.
- **`503` / `tab create timed out`:** check `docker compose logs bwl`. The dashboard at `http://localhost:6080` shows each tab's call log.

## Tests

```bash
npm run test:mcp    # handshake tests, in-repo and from the packed tarball
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/mcp-contracts.test.js   # REST traffic per tool, against a mock server
```
