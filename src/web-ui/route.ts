// Routing: "" (or "#") = grid overview, "#tab/<userId>/<tabId>" = single-tab detail.
export type Route = { kind: "grid" } | { kind: "detail"; userId: string; tabId: string };

export function parseRoute(hash = location.hash): Route {
  const match = /^#tab\/([^/]+)\/([^/]+)$/.exec(hash);
  if (!match) return { kind: "grid" };
  return { kind: "detail", userId: decodeURIComponent(match[1]!), tabId: decodeURIComponent(match[2]!) };
}

export function openTab(userId: string, tabId: string) {
  location.hash = `tab/${encodeURIComponent(userId)}/${encodeURIComponent(tabId)}`;
}

export function showGrid() {
  location.hash = "";
}
