# Bloom Web Link

A headless, anti-detection browser built for AI agents. It runs in Docker and gives agents a real Firefox ([Camoufox](https://camoufox.com)) over **MCP**. A live web dashboard shows every tab the agents have open.

- **MCP endpoint:** `http://localhost:9377/mcp` (Streamable HTTP)
- **Dashboard:** `http://localhost:6080`
- **REST API:** `http://localhost:9377` (OpenAPI spec at `/openapi.json`)

## Quick start

bwl only runs in Docker. Pick one of two ways.

### Option 1: pull the prebuilt image (recommended)

No clone and no build. The image is published to GitHub Container Registry (linux/amd64) with every release.

```bash
docker run -d --name bwl --restart unless-stopped --shm-size=2gb \
  -p 127.0.0.1:9377:9377 -p 127.0.0.1:6080:6080 \
  -v bwl-data:/root/.bwl \
  ghcr.io/luniiya/bloom-web-link:latest
```

Pin a version instead of `latest` for reproducible setups, e.g. `ghcr.io/luniiya/bloom-web-link:2.0.0`. To update: `docker pull ghcr.io/luniiya/bloom-web-link:latest`, then `docker rm -f bwl` and run the command again. Your data stays in the `bwl-data` volume.

### Option 2: clone and build

```bash
git clone https://github.com/luniiya/bloom-web-link.git
cd bloom-web-link
docker compose up -d --build
```

Or, without Compose:

```bash
make up      # builds the image if missing, then starts the container
make down    # stop and remove it
make reset   # rebuild from scratch
```

Everything binds to `127.0.0.1` only. Browser data (cookies, profiles) is kept in the `bwl-data` volume.

## Connect an agent

1. Open the dashboard at `http://localhost:6080`.
2. Pick the browser profile the agent should use, then press **Connect your agent**. This copies a ready-made setup prompt to your clipboard (the eye icon next to it previews the prompt).
3. Paste it into a chat with your agent. It will figure out the rest: adding the MCP server, picking up its profile, and starting to browse.

Prefer to wire it up by hand? Point any MCP client that speaks Streamable HTTP at `http://localhost:9377/mcp`.

```bash
# Claude Code
claude mcp add --transport http bloom-web-link http://localhost:9377/mcp
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.bloom-web-link]
url = "http://localhost:9377/mcp"
```

```json
// Cursor, .mcp.json and most other clients
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
| `bwl_save_page` | Save the current page or document (like Ctrl+S) into the tab's downloads |
| `bwl_downloads` | List a tab's downloaded files (with `curl`-able URLs) or fetch one inline |
| `bwl_list_tabs` | List open tabs (yours plus all profile tabs) |
| `bwl_create_profile` | Create a named or burner browser profile |
| `bwl_list_profiles` | List browser profiles |
| `bwl_delete_profile` | Move a profile to the trash (restorable from the dashboard for 30 days) |
| `bwl_close_tab` | Close a tab |
| `bwl_import_cookies` | Import a Netscape cookie file (requires `BWL_API_KEY`) |

The typical loop is **snapshot → act by ref → snapshot again**. Refs are more reliable than CSS selectors.

## Profiles

A **profile** is a separate Camoufox browser with its own fingerprint (user agent, screen, fonts, canvas/audio noise), cookies, storage and tab history, so sites can't link it to other profiles. Profiles are global: any agent can open tabs in them, and they show up in the dashboard.

- **`main`** is the default. Tabs opened without a `profile` go into it, so every agent shares its cookies and logins. It always exists and can't be deleted.
- **Named profiles** (`bwl_create_profile({name: "shopping"})`) are kept until you delete them (and then 30 days in the trash).
- **Burner profiles** (`bwl_create_profile({burner: true})`, or `bwl_create_tab({profile: "burner"})`) get a generated name. They're wiped, along with their history, after `BWL_BURNER_TTL_DAYS` days (default 30) without use.

Open a tab in a profile with `bwl_create_tab({url, profile: "shopping"})`. All other tab tools work on profile tabs as usual. The fingerprint is created once and reused on every launch, so a profile stays the same "machine" across restarts: same user agent, screen, CPU count, WebGL GPU and font/audio noise. One exception: Camoufox re-rolls canvas noise for every new browser context, so the canvas hash is stable while a profile's session is open but changes after its browser restarts.

Each profile can also set (in the dashboard's **New profile** popup, or as `bwl_create_profile` arguments):

- `screen`: the spoofed monitor as `WIDTHxHEIGHT`, default `1920x1080` at 1x. The window is reported as maximized above the OS taskbar (Windows 48px bottom, macOS 25px menu bar, Linux 32px top bar).
- `os`: `windows`, `macos` or `linux` for the user agent, platform and fonts. Defaults to the host OS. The TCP/IP stack is still the host's, so pair a non-host OS with a proxy if a site checks that.
- `locale` and `timezone` (e.g. `fr-FR`, `Europe/Paris`): they override the proxy's geoip and `BWL_LOCALE` / `BWL_TIMEZONE`.

- `settings` (all optional; the defaults are what a typical computer of that OS reports):
  - `gpu`: a real WebGL vendor/renderer pair for that OS (`GET /profiles/options` lists them; software renderers are left out because they give a VM away). Picking a GPU also picks a fitting core count.
  - `cores`, `mics`, `speakers`, `webcams`: CPU threads and media devices. Nearly every Mac has a webcam; Windows and Linux machines less often.
  - `voices`: `auto` lists the OS's speech voices (Windows SAPI voices such as Hortense/David/Zira, the macOS set, none on Linux); `none` lists none.
  - `doNotTrack`, `globalPrivacyControl`, `webrtc` (`real` or `block`), `geoip` (timezone and location from the public IP, using the GeoLite database baked into the image), `humanize` (curved mouse paths).
  - `drift` (on by default): the machine changes a little over time. Each day there's a small chance a headset (a mic and an output) or a webcam appears or disappears, and about one launch in seven uses a restored window instead of a maximized one.

**Configure** on a profile row (or `PATCH /profiles/:profile`) changes any of these in place and restarts its browser, keeping the fingerprint, cookies and storage. Changing the OS gives it a new fingerprint, since fonts, GPU and user agent differ per OS. **New fingerprint** inside the dialog (or `POST /profiles/:profile/fingerprint`) closes the browser and gives the profile a new machine identity. Cookies and storage are kept.

**Deleting** a profile (the trash icon, `DELETE /profiles/:profile` or `bwl_delete_profile`) moves it to the trash: its tabs close and it disappears, but its fingerprint, cookies and storage are kept for 30 days. **Show trash** lists trashed profiles with a **Restore** button (`GET /profiles/trash`, `POST /profiles/:profile/restore`). After 30 days they are erased; there is deliberately no permanent-delete button. A trashed name can't be reused until it's restored or erased. The default `main` profile can't be deleted.

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
| `BWL_PUBLIC_MCP_URL` | _derived_ | MCP URL shown in the dashboard's "Connect your agent" prompt. Defaults to the dashboard's host with `BWL_MCP_PORT`; set it when agents reach bwl through a proxy or another hostname |
| `BWL_LOCALE` / `BWL_TIMEZONE` | _auto_ | Browser locale and timezone |
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

Tabs stay open until they are closed. Sessions and tabs never expire from idleness
by default (`SESSION_TIMEOUT_MS=0`, `TAB_INACTIVITY_MS=0`); set positive milliseconds
to opt into idle cleanup. At the tab limit (`MAX_TABS_PER_SESSION`, default 25, and
`MAX_TABS_GLOBAL`, default 50) a new tab is refused with a "close a tab first" error;
set `BWL_RECYCLE_TABS=true` to close the least-used tab instead.
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
