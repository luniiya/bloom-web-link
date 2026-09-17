import { createMcpHandler } from "../src/mcp/server.ts";
import { containerConfig } from "../src/config.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const build = await Bun.build({
  entrypoints: [new URL("../src/web-ui/client.ts", import.meta.url).pathname],
  target: "browser",
});
assert(build.success && build.outputs.length === 1, "Web UI client did not bundle");

const handleMcp = createMcpHandler(containerConfig);
const commonHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
const secureHandler = createMcpHandler({ ...containerConfig, publicAccessKey: "smoke-secret" });
const rejected = await secureHandler(new Request("http://localhost/mcp", {
  method: "POST",
  headers: commonHeaders,
  body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }),
}));
assert(rejected.status === 401, "HTTP MCP accepted a request without the configured access key");

const initialize = await handleMcp(new Request("http://localhost/mcp", {
  method: "POST",
  headers: commonHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "container-smoke", version: "1" },
    },
  }),
}));
const sessionId = initialize.headers.get("mcp-session-id");
assert(initialize.ok && sessionId, `MCP initialize failed (${initialize.status})`);

const toolsResponse = await handleMcp(new Request("http://localhost/mcp", {
  method: "POST",
  headers: { ...commonHeaders, "mcp-session-id": sessionId },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
}));
const toolsPayload = await toolsResponse.json() as { result?: { tools?: unknown[] } };
assert(toolsPayload.result?.tools?.length === 13, "HTTP MCP did not expose all 13 tools");

console.log("Container smoke passed: Web UI bundled; HTTP MCP initialized with 13 tools.");
