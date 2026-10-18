import { authHeaders } from "./api.ts";
import { isCopyShortcut, isPasteShortcut, keyToPress } from "./keys.ts";
import { parseRoute } from "./route.ts";
import { queueScreenshot } from "./screenshots.ts";

// --- Keyboard: while the detail screen has focus, keystrokes go to the page. ---
// Printable characters are batched briefly and typed into the page's focused
// element; everything else (Enter, arrows, Ctrl/Cmd chords) is a key press.
// A promise chain keeps text and presses in the order they were typed.
let keyboardChain: Promise<unknown> = Promise.resolve();
let pendingText = "";
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function sendKeyboard(input: { text: string } | { key: string }) {
  const route = parseRoute();
  if (route.kind !== "detail") return;
  keyboardChain = keyboardChain
    .then(() => fetch("/api/keyboard", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ userId: route.userId, tabId: route.tabId, ...input }),
    }))
    .catch(() => {})
    .then(() => queueScreenshot(route.userId, route.tabId, true));
}

function flushText() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!pendingText) return;
  const text = pendingText;
  pendingText = "";
  sendKeyboard({ text });
}

/** keydown on the detail screen. `report` shows a status message (clipboard failures). */
export function handleScreenKeyDown(event: KeyboardEvent, report: (message: string) => void) {
  if (event.isComposing) return;
  if (isCopyShortcut(event)) {
    event.preventDefault();
    flushText();
    const route = parseRoute();
    keyboardChain = keyboardChain.then(async () => {
      if (route.kind !== "detail") return;
      const response = await fetch("/api/clipboard", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ userId: route.userId, tabId: route.tabId }),
      });
      if (!response.ok) throw new Error("Copy failed");
      const { text } = await response.json() as { text: string };
      if (text) await navigator.clipboard.writeText(text);
    }).catch(() => {
      report("Copy blocked: allow clipboard access for this dashboard, then try again.");
    });
    return;
  }
  if (isPasteShortcut(event)) {
    // Read while this user gesture is active. The remote browser has a
    // separate clipboard; forwarding Control+v cannot paste local text.
    if (!navigator.clipboard?.readText) return; // allow native paste fallback
    event.preventDefault();
    flushText();
    const clipboard = navigator.clipboard.readText();
    const route = parseRoute();
    keyboardChain = keyboardChain.then(async () => {
      const text = await clipboard;
      if (!text || route.kind !== "detail") return;
      await fetch("/api/keyboard", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ userId: route.userId, tabId: route.tabId, text }),
      });
      queueScreenshot(route.userId, route.tabId, true);
    }).catch(() => {
      report("Paste blocked: allow clipboard access for this dashboard, then try again.");
    });
    return;
  }
  event.preventDefault();
  const chord = event.ctrlKey || event.metaKey || event.altKey;
  const key = keyToPress(event);
  if (key === null) return;
  if (!chord && event.key.length === 1) {
    pendingText += event.key;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushText, 120);
    return;
  }
  flushText();
  sendKeyboard({ key });
}

/** paste event on the detail screen (native paste fallback when the async clipboard API is missing). */
export function handleScreenPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  pendingText += text;
  flushText();
}

/** Click on the detail screen: map to page coordinates and forward it. */
export async function handleScreenClick(event: MouseEvent, image: HTMLImageElement, screen: HTMLElement) {
  const route = parseRoute();
  if (route.kind !== "detail") return;
  if (!image.naturalWidth || !image.naturalHeight) return;
  const bounds = image.getBoundingClientRect();
  const ratio = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const contentWidth = image.naturalWidth * ratio;
  const contentHeight = image.naturalHeight * ratio;
  const offsetX = (bounds.width - contentWidth) / 2;
  const offsetY = (bounds.height - contentHeight) / 2;
  const x = (event.clientX - bounds.left - offsetX) / ratio;
  const y = (event.clientY - bounds.top - offsetY) / ratio;
  screen.focus();
  if (x < 0 || y < 0 || x > image.naturalWidth || y > image.naturalHeight) return;
  await fetch("/api/click", {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({ userId: route.userId, tabId: route.tabId, x, y }),
  });
  setTimeout(() => queueScreenshot(route.userId, route.tabId, true), 250);
}
