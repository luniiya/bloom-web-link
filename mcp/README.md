# bloom-web-link MCP server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server that exposes bloom-web-link to any MCP-compatible host — Claude Code, Cursor, etc. — without requiring OpenClaw.

It mirrors the existing OpenClaw plugin **1:1**: same 13 tool names, identical JSON-Schema parameters, and the same REST routes. Whether an agent reaches bwl via OpenClaw or MCP, the behavior is identical.

The initial MCP server implementation was contributed by [@epicsagas](https://github.com/epicsagas).

## Container-native HTTP MCP

The default Docker image also exposes stateful Streamable HTTP MCP directly:

```text
http://localhost:9377/mcp
```

Each initialized MCP connection receives an isolated Bloom Web Link browser context. Clients may send `X-BWL-User-Id` during initialization to choose a stable user ID; otherwise the server generates one. A transport disconnect does not close that browser context: reconnect with the same user ID to resume it. If `BWL_ACCESS_KEY` is configured, send it as `Authorization: Bearer <key>`.

Use the stdio adapter documented below only when the MCP host cannot connect to a remote Streamable HTTP endpoint.

## Architecture

The MCP server is a thin stdio client over the bwl REST server. Two pieces:

- **REST server** (`server.js`) — launches Camoufox, exposes the HTTP API on `:9377`. Run **once**, it stays up.
- **MCP server** (`mcp/server.mjs`, exposed as the `bloom-web-link-mcp` bin) — translates MCP tool calls into REST calls. Claude Code spawns one **per session**.

Registering the MCP server does **not** require being inside the bloom-web-link checkout. The examples below work from any directory.

`mcp/` is also an **independently installable package** (`@askjo/bloom-web-link-mcp`, its own `package.json`). It depends on nothing but `@modelcontextprotocol/sdk` — no `camoufox-js`, `playwright-core`, `express`, or the ~300MB browser binary download that the core server pulls in. Tool names, JSON-Schema parameters, REST routes, and response shaping are defined in `mcp/lib/tool-contracts.mjs`, which ships inside the standalone package. The OpenClaw plugin (`plugin.ts`) imports the same canonical module, so the two hosts cannot drift. See **Option D** below if you only want the MCP adapter (e.g. pointing `BWL_BASE_URL` at a REST server running elsewhere).

## 1. Start the REST server

Clone the repo and start the server (one-time binary download on first run):

```bash
git clone https://github.com/jo-inc/bloom-web-link && cd bloom-web-link
npm install   # downloads Camoufox (~300MB) on first run
npm start     # → http://localhost:9377
```

This stays running in the background. It does not need to be your cwd afterwards.

## 2. Install the `bloom-web-link-mcp` bin

The MCP server is the same for every host — what differs is only the config file you paste into. First, make the `bloom-web-link-mcp` bin available on your PATH. Pick one:

```bash
# Option A — npm link (if you have the source checkout; picks up local edits)
cd bloom-web-link && npm link

# Option B — global install (no source checkout needed)
npm install -g @askjo/bloom-web-link

# Option C — npx (no install; runs the published standalone adapter)
#   Use this wherever a command is expected below.
npx -y @askjo/bloom-web-link-mcp

# Option D — MCP adapter only, no core server deps (lightest footprint)
#   Skips camoufox-js/playwright-core/express and the browser binary download —
#   use this if a bloom-web-link REST server is already running (locally or
#   remotely) and you only need the stdio adapter.
git clone https://github.com/jo-inc/bloom-web-link && cd bloom-web-link/mcp
npm install   # installs only @modelcontextprotocol/sdk (~24MB, no postinstall)
npm link      # bloom-web-link-mcp now resolves from any directory
```

Verify the bin resolves from any directory:

```bash
which bloom-web-link-mcp   # → .../bin/bloom-web-link-mcp
```

## 3. Register with your host

All five hosts speak standard MCP, so they all run the same `bloom-web-link-mcp` bin. Pick your host's config snippet below.

### Claude Code

```bash
# CLI (user scope = available in every project)
claude mcp add bloom-web-link -s user -- bloom-web-link-mcp
```

Or in `~/.claude.json` (user) / `.mcp.json` (project, checked in):

```json
{
  "mcpServers": {
    "bloom-web-link": {
      "command": "bloom-web-link-mcp"
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml` (user) or `.codex/config.toml` (project, trusted dirs only):

```toml
[mcp_servers.bloom-web-link]
command = "bloom-web-link-mcp"
env = { BWL_BASE_URL = "http://localhost:9377" }
```

### Antigravity / agy

Global `~/.gemini/config/mcp_config.json` or workspace `.agents/mcp_config.json`:

```json
{
  "mcpServers": {
    "bloom-web-link": {
      "command": "bloom-web-link-mcp"
    }
  }
}
```

### Cursor

Global `~/.cursor/mcp.json` or project `.cursor/mcp.json` (checked in):

```json
{
  "mcpServers": {
    "bloom-web-link": {
      "command": "bloom-web-link-mcp"
    }
  }
}
```

(Or via UI: Settings → Cursor Settings → MCP → Add New MCP Server.)

### opencode

`opencode.json` in the project root, or global `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "bloom-web-link": {
      "type": "local",
      "command": ["bloom-web-link-mcp"]
    }
  }
}
```

### Common: env vars and from-source fallback

If you need cookie import or a non-default REST URL, add env. Example for Claude Code:

```bash
claude mcp add bloom-web-link -s user \
  --env BWL_BASE_URL=http://localhost:9377 \
  --env BWL_API_KEY=<key> \
  -- bloom-web-link-mcp
```

For the other hosts, add the same keys to the `env` / `environment` field of that host's snippet.

**From-source fallback** (only if you're inside the checkout and haven't linked the bin):

```bash
# Replace `bloom-web-link-mcp` with `node /absolute/path/to/mcp/server.mjs`
claude mcp add bloom-web-link -- node /Users/you/src/bloom-web-link/mcp/server.mjs
```

> ⚠️ Always prefer the `bloom-web-link-mcp` bin (options A/B/C/D above). The `node ./mcp/server.mjs` form is **path-dependent** — relative paths break outside the checkout.

## 4. Verify

| Host | How to verify |
|------|---------------|
| Claude Code | `/mcp` — `bloom-web-link` shows connected |
| Codex CLI | `codex` then check MCP server list |
| agy | `/mcp` overlay in the `agy` CLI |
| Cursor | Settings → MCP — server shows green |
| opencode | `opencode mcp list` |

You should see 13 tools: `bwl_create_tab`, `bwl_snapshot`, `bwl_click`, `bwl_wait`, `bwl_mouse`, `bwl_type`, `bwl_navigate`, `bwl_scroll`, `bwl_screenshot`, `bwl_evaluate`, `bwl_list_tabs`, `bwl_close_tab`, `bwl_import_cookies`.

## Tools

| Tool | Purpose |
|------|---------|
| `bwl_create_tab` | Open a URL → returns `tabId` |
| `bwl_snapshot` | Accessibility snapshot + element refs (`e1`, `e2`, ...) + screenshot |
| `bwl_navigate` | Go to a URL **or** use a search macro (`@google_search`, `@reddit_search`, ...) |
| `bwl_click` | Click by element ref (`e1`) or CSS selector |
| `bwl_type` | Type text into a ref/selector, optional `pressEnter` |
| `bwl_scroll` | Scroll by pixels (unreliable on lazy-load pages — prefer `bwl_evaluate`) |
| `bwl_screenshot` | Standalone screenshot |
| `bwl_evaluate` | Run JS in page context — extract data, call page APIs, scroll via `window.scrollTo` |
| `bwl_list_tabs` | List open tabs in this session |
| `bwl_close_tab` | Close a tab |
| `bwl_import_cookies` | Import a Netscape cookie file (needs `BWL_API_KEY`) |

## Workflow

Every interaction follows the same shape — **snapshot before you act**:

1. `create_tab({ url })` → `tabId`
2. `snapshot({ tabId })` → element refs (`e1`, `e2`, ...)
3. `click`/`type` using those refs
4. `snapshot` again to read the new state
5. `close_tab` when done

Element refs are unambiguous and preferred over CSS selectors — a selector that matches multiple elements returns `422 strict mode violation`, in which case re-snapshot and click by ref.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `BWL_BASE_URL` | `http://localhost:9377` | REST server URL |
| `BWL_USER_ID` | `mcp-<random>` | Browser-session identity. Set a durable value (for example `bwl-shared`) in a host-wide MCP config to let later agents resume the same tabs and storage. Agents sharing it must coordinate writes. |
| `BWL_SESSION_KEY` | `default` | Tab partition within the user |
| `BWL_ACCESS_KEY` | _(unset)_ | Global bearer token gating the REST server (superkey). If set, forwarded as `Authorization: Bearer <key>` on **every** tool call automatically — must match the REST server's own `BWL_ACCESS_KEY`. Without this, a globally-authenticated REST server rejects all tool calls except cookie import. |
| `BWL_API_KEY` | _(unset)_ | Self-chosen secret gating cookie import. Optional on localhost; required on remote/production and must match the REST server's `BWL_API_KEY`. Only affects `bwl_import_cookies`. |

## Troubleshooting

- **`503 session_expired` / `tab create timed out`** — the REST server's browser session died (often after a prior failed call destabilized it). Restart `npm start`.
- **`bwl_scroll` returns `{ok:true}` but the page doesn't move** — expected on lazy-load / virtual-scroll pages; the server's `mouse.wheel` no-ops there. Use `bwl_evaluate` with `window.scrollTo` / `scrollBy`.
- **`422 strict mode violation ... resolved to N elements`** on `click` — CSS selector matched multiple elements. Re-snapshot and click by element ref.
- **`403 Forbidden` on `bwl_import_cookies`** — key mismatch between REST server and MCP server, or hitting a remote server without `BWL_API_KEY`.
- **`401`/`403` on every tool call, not just cookie import** — the REST server has `BWL_ACCESS_KEY` set. Set the same `BWL_ACCESS_KEY` in the MCP server's env (see table above) — it's forwarded automatically as `Authorization: Bearer` once set.

## Testing (developer)

Two layers, covering different things:

```bash
# 1. `test:mcp` installs the standalone adapter's locked dependencies, then
#    runs the in-repository and packed-tarball handshake tests. Neither needs
#    a REST server.
npm run test:mcp

# 2. Mock-HTTP contract tests — verifies the actual REST traffic each tool
#    produces: routes, methods, request bodies, BWL_ACCESS_KEY/BWL_API_KEY
#    auth headers, cookie parsing (Netscape file → `{ cookies }` body, never a
#    path), screenshot decoding, and error handling. Mocked REST server — no
#    live bloom-web-link process needed. This is what makes the "OpenClaw and
#    MCP send identical requests" claim verifiable, not just asserted.
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/mcp-contracts.test.js
```

The packed-tarball check installs the generated `@askjo/bloom-web-link-mcp` tarball in an empty directory before its handshake. It catches imports that reach outside the standalone package.
