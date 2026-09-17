import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

function port(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

const publicAccessKey = (process.env.CAMOFOX_ACCESS_KEY || "").trim();
const internalAccessKey = publicAccessKey || `internal-${randomUUID()}`;
const host = (process.env.CAMOFOX_BIND_HOST || "0.0.0.0").trim();
const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;

export const containerConfig = {
  host,
  packageVersion,
  mcpPort: port(process.env.CAMOFOX_MCP_PORT || process.env.PORT, 9377),
  webPort: port(process.env.CAMOFOX_WEB_PORT, 6080),
  corePort: port(process.env.CAMOFOX_INTERNAL_PORT, 9378),
  coreHost: "127.0.0.1",
  publicAccessKey,
  internalAccessKey,
  apiKey: process.env.CAMOFOX_API_KEY || "",
  adminKey: process.env.CAMOFOX_ADMIN_KEY || "",
  cookiesDir: process.env.CAMOFOX_COOKIES_DIR || join(homedir(), ".camofox", "cookies"),
  coreEnv: { ...process.env } as Record<string, string>,
};

export type ContainerConfig = typeof containerConfig;
