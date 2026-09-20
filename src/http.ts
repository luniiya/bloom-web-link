import type { ContainerConfig } from "./config.ts";

export function bearerToken(request: Request): string {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function tokensEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function isAuthorized(request: Request, config: ContainerConfig): boolean {
  return !config.publicAccessKey || tokensEqual(bearerToken(request), config.publicAccessKey);
}

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers });
}

export function unauthorized(): Response {
  return json(
    { error: "Unauthorized" },
    401,
    { "WWW-Authenticate": 'Bearer realm="bwl"' },
  );
}

export function internalHeaders(config: ContainerConfig, headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("authorization", `Bearer ${config.internalAccessKey}`);
  result.delete("host");
  return result;
}
