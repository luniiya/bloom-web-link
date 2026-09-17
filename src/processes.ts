import type { ContainerConfig } from "./config.ts";

export function startCore(config: ContainerConfig): Bun.Subprocess {
  return Bun.spawn({
    cmd: ["bun", "run", "server.js"],
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...config.coreEnv,
      NODE_ENV: "production",
      CAMOFOX_PORT: String(config.corePort),
      CAMOFOX_BIND_HOST: config.coreHost,
      CAMOFOX_ACCESS_KEY: config.internalAccessKey,
    },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
}

export async function waitForCore(baseUrl: string, accessKey: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${accessKey}` },
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Camofox core did not become ready: ${lastError}`);
}
