# Bloom Web Link

A headless, anti-detection browser built for AI agents. It runs in Docker and gives agents a real Firefox ([Camoufox](https://camoufox.com)) over **MCP**. A live web dashboard shows every tab the agents have open.

- **MCP endpoint:** `http://localhost:9377/mcp` (Streamable HTTP)
- **Dashboard:** `http://localhost:6080`
- **REST API:** `http://localhost:9377` (OpenAPI spec at `/openapi.json`)

## Quick start

bwl only runs in Docker.

```bash
docker compose up -d --build
```

Or, without Compose:

```bash
make up      # builds the image if missing, then starts the container
make down    # stop and remove it
make reset   # rebuild from scratch
```

Both bind to `127.0.0.1` only. Browser data (cookies, profiles) is kept in the `bwl-data` volume.

## Connect an agent

Point any MCP client that speaks Streamable HTTP at `/mcp`.

**Claude Code**

```bash
claude mcp add --transport http bloom-web-link http://localhost:9377/mcp
```

**Other clients** (`.mcp.json`, Cursor, etc.)

```json
{
  "mcpServers": {
    "bloom-web-link": {
      "type": "http",
      "url": "http://localhost:9377/mcp"
    }
  }
}
```

Each MCP connection gets its own isolated browser context (separate cookies and storage). To resume the same context later, send a stable `X-BWL-User-Id` header when the connection starts. A disconnect does not close the context.

If `BWL_ACCESS_KEY` is set, send `Authorization: Bearer <key>`.

For hosts that only support stdio, a thin adapter lives in [`mcp/`](mcp/README.md).

## Tools

| Tool | What it does |
|------|--------------|
| `bwl_create_tab` | Open a new tab at a URL and return its `tabId` |
| `bwl_snapshot` | Accessibility snapshot with element refs (`e1`, `e2`, …) |
| `bwl_read_text` | Cheap text-only read of the page |
| `bwl_click` | Click by ref, CSS selector, or coordinates |
| `bwl_type` | Type into an element, optionally pressing Enter |
| `bwl_select` | Pick an option in a native `<select>` |
| `bwl_mouse` | Move, hover, or drag the mouse |
| `bwl_scroll` | Scroll the page |
| `bwl_wait` | Wait for page readiness, a selector, text, or a URL |
| `bwl_navigate` | Go to a URL or run a search macro (`@google_search`, …) |
| `bwl_screenshot` | Capture a screenshot |
| `bwl_element_state` | Computed style and ARIA state for selectors |
| `bwl_evaluate` | Run JavaScript in the page |
| `bwl_batch` | Run several actions in one call |
| `bwl_list_tabs` | List open tabs (yours plus all profile tabs) |
| `bwl_create_profile` | Create a named or burner browser profile |
| `bwl_list_profiles` | List browser profiles |
| `bwl_delete_profile` | Delete a profile and everything it stored |
| `bwl_close_tab` | Close a tab |
| `bwl_import_cookies` | Import a Netscape cookie file (requires `BWL_API_KEY`) |

The typical loop is **snapshot → act by ref → snapshot again**. Refs are more reliable than CSS selectors.

## Profiles

A **profile** is a separate Camoufox browser with its own fingerprint (user agent, screen, fonts, canvas/audio noise), cookies, storage and tab history, so sites can't link it to other profiles. Profiles are global: any agent can open tabs in them, and they show up in the dashboard.

- **`main`** is the default. Tabs opened without a `profile` go into it, so every agent shares its cookies and logins. It always exists and can't be deleted.
- **Named profiles** (`bwl_create_profile({name: "shopping"})`) are kept until you delete them.
- **Burner profiles** (`bwl_create_profile({burner: true})`, or `bwl_create_tab({profile: "burner"})`) get a generated name. They're wiped, along with their history, after `BWL_BURNER_TTL_DAYS` days (default 30) without use.

Open a tab in a profile with `bwl_create_tab({url, profile: "shopping"})`. All other tab tools work on profile tabs as usual. The fingerprint is created once and reused on every launch, so a profile stays the same "machine" across restarts: same user agent, screen, CPU count, WebGL GPU and font/audio noise. One exception: Camoufox re-rolls canvas noise for every new browser context, so the canvas hash is stable while a profile's session is open but changes after its browser restarts.

Each profile with open tabs runs its own browser process, which uses roughly 300–500 MB of RAM. It shuts down after `BROWSER_IDLE_TIMEOUT_MS` once its tabs are closed, and `BWL_MAX_PROFILE_BROWSERS` caps how many can run at once.

## Dashboard

`http://localhost:6080` shows every open tab across all agent sessions, with live thumbnails. Tabs that close move to a "Closed" section. Open a tab to see a larger live view.

## Configuration

Set these in the environment (or a `.env` file next to `compose.yaml`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `BWL_ACCESS_KEY` | _unset_ | Bearer token required for MCP, REST, and the dashboard |
| `BWL_API_KEY` | _unset_ | Secret required for cookie import |
| `BWL_ADMIN_KEY` | _unset_ | Secret required for `POST /stop` |
| `BWL_MCP_PORT` | `9377` | MCP + REST port |
| `BWL_WEB_PORT` | `6080` | Dashboard port |
| `BWL_LOCALE` / `BWL_TIMEZONE` | _auto_ | Browser locale and timezone |
| `BWL_CRASH_REPORT_ENABLED` | `false` | Anonymized crash reporting |
| `BWL_MAX_PROFILE_BROWSERS` | `4` | Profile browsers allowed to run at once |
| `BWL_BURNER_TTL_DAYS` | `30` | Days without use before a burner profile is wiped (`0` keeps them) |

Plugin toggles (YouTube transcripts, persistence) live in [`bwl.config.json`](bwl.config.json).

## Architecture

One container runs three pieces:

```
            :9377                          :6080
  agents ──► gateway (Bun) ── /mcp       dashboard (Bun)
                 │                            │
                 └──────► browser core ◄──────┘
                          (server.js, Camoufox, internal :9378)
```

- **Gateway** (`src/gateway.ts`) serves MCP at `/mcp` and proxies REST calls to the core, enforcing auth.
- **Core** (`server.js`, `lib/`) drives Camoufox through Playwright and manages sessions, tabs, and snapshots.
- **Dashboard** (`src/web-ui/`) polls the core and renders tabs.

## Development

```bash
npm run test:unit        # unit tests
npm run test:e2e         # end-to-end tests against a real browser
npm run test:container   # typecheck + container smoke test
npm run test:mcp         # MCP adapter tests
```

[automationexercise.com/test_cases](https://www.automationexercise.com/test_cases) is a good real-world site for checking tools end to end.

## Credits

bwl started as a fork of Jo Inc's Camoufox browser server and is built on [Camoufox](https://camoufox.com). MIT licensed; see [LICENSE](LICENSE).


### Keeping interactive tabs safe

The local Docker Compose setup disables automatic session and tab idle expiry by
default (`SESSION_TIMEOUT_MS=0`, `TAB_INACTIVITY_MS=0`). Set positive milliseconds
 to opt into idle cleanup. Outside Compose, tab idle cleanup defaults to 30 minutes and session expiry to 10 minutes; protected tabs bypass both timers.
A tab being viewed in the dashboard receives a short renewable viewing lease.
Use **Keep open**, or `bwl_keep_open({tabId})`, to protect it even when the dashboard
is hidden. Explicit close still works. Automatic recycling, idle expiry and
navigation recovery preserve protected tabs; browser crashes and forced restarts
can still close them.

### Waiting for chat replies

`bwl_wait_for_reply` watches DOM mutations, returns only new messages, and protects
the tab for the duration of the wait. Choose a CSS `messageSelector` matching each
incoming message (not the whole transcript). Optionally provide a `typingSelector`
matching the site's visible typing indicator. Without a selector, typing is
reported as `unknown`; no indicator is guessed from elapsed time.

1. Call with `timeout: 0` to establish a baseline and get a cursor **before sending**.
2. Send your message, then call with the same selectors and cursor, up to 55 seconds.
3. Reuse the returned cursor on subsequent waits, including after a timeout.

Replies arriving between calls are returned too. A quiet period (default 700ms)
settles streamed text, and the tool waits for the typing indicator to stop unless
`waitForTyping` is false. Cancellation propagates from MCP to the browser watcher.
Each tab supports one active reply wait. Selectors target the main document; framed
chats currently need a main-document selector or a site-specific integration.

### Recovering a closed tab

The dashboard keeps a bounded, local history of closed URLs and closure reasons
across reloads and restarts. **Reopen saved URL** opens a new tab using the saved
login; the website decides whether an old live conversation can reconnect.
**Save last read text** downloads content already read by a text/snapshot/reply tool.
Cleanup does not scrape extra page content. The last 100 closed tabs and up to
50,000 characters per tab are stored under the profile directory, not sent elsewhere.
Agents can retrieve an entry with `bwl_tab_history({tabId})`.

After idle cleanup closes the final session, BWL retires the empty browser runtime. The next request launches a fresh browser using saved login data. It rechecks for new sessions and in-progress session creation before retiring.
