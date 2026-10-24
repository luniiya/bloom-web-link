import { describe, expect, test } from "bun:test";
import { buildAgentPrompt, defaultMcpUrl } from "../../src/web-ui/agent-prompt.ts";

const base = { mcpUrl: "http://localhost:9377/mcp", profile: "shopping", authRequired: false, profiles: ["main", "shopping", "work"] };

describe("buildAgentPrompt", () => {
  const prompt = buildAgentPrompt(base);

  test("names the agent's dedicated profile and how to use it", () => {
    expect(prompt).toContain("Your dedicated browser profile is `shopping`");
    expect(prompt).toContain('bwl_create_tab({ url, profile: "shopping" })');
  });

  test("lists the other profiles as usable with a reason, not forbidden", () => {
    expect(prompt).toContain("Other profiles exist (`main`, `work`)");
    expect(prompt).toContain("only when there is a real reason");
  });

  test("includes the endpoint and setup commands", () => {
    expect(prompt).toContain("MCP endpoint (Streamable HTTP): http://localhost:9377/mcp");
    expect(prompt).toContain("claude mcp add --transport http bloom-web-link http://localhost:9377/mcp\`");
    expect(prompt).toContain('"url": "http://localhost:9377/mcp" }');
  });

  test("asks the agent to save it to AGENTS.md / CLAUDE.md", () => {
    expect(prompt).toContain("`AGENTS.md` or `CLAUDE.md`");
  });

  test("covers saving pages and pulling downloaded files", () => {
    expect(prompt).toContain("bwl_save_page({ tabId })");
    expect(prompt).toContain("bwl_downloads({ tabId, downloadId })");
  });

  test("auth adds a placeholder header, never a real key", () => {
    const secured = buildAgentPrompt({ ...base, authRequired: true });
    expect(secured).toContain('--header "Authorization: Bearer <BWL_ACCESS_KEY>"');
    expect(secured).toContain('"headers": { "Authorization": "Bearer <BWL_ACCESS_KEY>" }');
    expect(prompt).not.toContain("BWL_ACCESS_KEY");
  });
});

describe("defaultMcpUrl", () => {
  test("uses the dashboard's host with the MCP port", () => {
    expect(defaultMcpUrl({ protocol: "http:", hostname: "192.168.1.5" }, 9377)).toBe("http://192.168.1.5:9377/mcp");
    expect(defaultMcpUrl({ protocol: "http:", hostname: "::1" }, 9000)).toBe("http://[::1]:9000/mcp");
  });
});
