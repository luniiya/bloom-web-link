import { containerConfig as config } from "./config.ts";
import { startCore, waitForCore } from "./processes.ts";
import { startGateway } from "./gateway.ts";
import { startWebUi } from "./web-ui/server.ts";

const coreUrl = `http://${config.coreHost}:${config.corePort}`;
const core = startCore(config);
let gateway: Bun.Server | undefined;
let webUi: Bun.Server | undefined;
let shuttingDown = false;

async function shutdown(signal: string, exitCode = 0): Promise<never> {
  if (shuttingDown) await new Promise(() => {});
  shuttingDown = true;
  console.log(`[container] shutting down (${signal})`);
  gateway?.stop(true);
  webUi?.stop(true);
  core.kill("SIGTERM");
  await Promise.race([core.exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await waitForCore(coreUrl, config.internalAccessKey);
  gateway = startGateway(config);
  webUi = await startWebUi(config);
  console.log(`[container] MCP: http://${config.host}:${config.mcpPort}/mcp`);
  console.log(`[container] Web UI: http://${config.host}:${config.webPort}/`);
} catch (error) {
  console.error("[container] startup failed", error);
  await shutdown("startup-failure", 1);
}

const coreExitCode = await core.exited;
if (!shuttingDown) {
  console.error(`[container] browser core exited unexpectedly (${coreExitCode})`);
  await shutdown("core-exit", coreExitCode || 1);
}
