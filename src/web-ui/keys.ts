/** Minimal shape of a KeyboardEvent, so this stays testable outside a browser. */
export type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift", "CapsLock", "Dead", "Unidentified"]);

/**
 * Translate a dashboard keydown into a Playwright `keyboard.press` key, e.g.
 * "Enter", "Control+a", "Shift+Tab". Returns null for bare modifier presses,
 * which carry nothing to send on their own.
 */
export function keyToPress(event: KeyLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const key = event.key === " " ? "Space" : event.key;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.metaKey) parts.push("Meta");
  if (event.altKey) parts.push("Alt");
  // Shift is already folded into printable characters ("A", "!").
  if (event.shiftKey && key.length > 1) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** Clipboard shortcuts must read the dashboard clipboard, not the remote one. */
export function isPasteShortcut(event: KeyLike): boolean {
  if (event.altKey) return false;
  return ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v")
    || (event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === "Insert");
}

export function isCopyShortcut(event: KeyLike): boolean {
  return !event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey)
    && event.key.toLowerCase() === "c";
}
