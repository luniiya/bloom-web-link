// Dashboard access key, kept in localStorage. Read lazily so modules that
// import this stay loadable outside a browser (tests render components).
let accessKey: string | null = null;

export function getAccessKey(): string {
  if (accessKey === null) accessKey = localStorage.getItem("bwl-access-key") || "";
  return accessKey;
}

export function setAccessKey(next: string) {
  accessKey = next.trim();
  if (accessKey) localStorage.setItem("bwl-access-key", accessKey);
  else localStorage.removeItem("bwl-access-key");
}

export function authHeaders(json = false): HeadersInit {
  const key = getAccessKey();
  return {
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}
