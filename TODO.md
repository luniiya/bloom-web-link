# Browser-handoff backlog

- [ ] Add an explicit, authenticated `bwl_attach_session` operation so a new
  agent can resume an existing browser session by durable handoff ID instead
  of receiving a fresh anonymous `mcp-<uuid>` user ID.
- [ ] Keep browser sessions alive when an MCP transport disconnects; make
  cleanup an explicit close/expiry action rather than a transport-close side
  effect.
- [ ] Add ownership leases: one agent holds write control of a tab at a time,
  while other agents may inspect it read-only. Support explicit transfer and
  safe takeover after lease expiry.
- [ ] Return a session/tab handoff token (not cookies or raw storage) from
  session creation and expose an attach/list endpoint for authorized agents.
- [ ] Add per-tab revision numbers and require `expectedRevision` on mutating
  actions, preventing two agents from silently acting on diverged UI state.
- [ ] Preserve action trace, screenshot, and latest semantic snapshot across
  handoff so a replacement agent has context before it acts.
