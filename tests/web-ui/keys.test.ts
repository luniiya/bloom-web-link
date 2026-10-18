import { describe, expect, test } from "bun:test";
import { keyToPress, isPasteShortcut, isCopyShortcut, type KeyLike } from "../../src/web-ui/keys.ts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("keyToPress", () => {
  test("passes named keys through", () => {
    expect(keyToPress(key("Enter"))).toBe("Enter");
    expect(keyToPress(key("Backspace"))).toBe("Backspace");
    expect(keyToPress(key("ArrowLeft"))).toBe("ArrowLeft");
  });

  test("maps the space character to Space", () => {
    expect(keyToPress(key(" "))).toBe("Space");
  });

  test("ignores bare modifier presses", () => {
    for (const modifier of ["Control", "Shift", "Alt", "Meta", "CapsLock", "Dead"]) {
      expect(keyToPress(key(modifier))).toBeNull();
    }
  });

  test("builds chords in Playwright order", () => {
    expect(keyToPress(key("a", { ctrlKey: true }))).toBe("Control+a");
    expect(keyToPress(key("z", { metaKey: true, shiftKey: true }))).toBe("Meta+z");
    expect(keyToPress(key("Tab", { shiftKey: true }))).toBe("Shift+Tab");
    expect(keyToPress(key("Delete", { ctrlKey: true, altKey: true }))).toBe("Control+Alt+Delete");
  });

  test("does not add Shift to printable characters (already shifted)", () => {
    expect(keyToPress(key("A", { shiftKey: true }))).toBe("A");
    expect(keyToPress(key("!", { shiftKey: true }))).toBe("!");
  });
});

describe("local clipboard shortcuts", () => {
  test("recognizes Ctrl/Cmd+V, plain-text paste, and Shift+Insert", () => {
    expect(isPasteShortcut(key("v", { ctrlKey: true }))).toBe(true);
    expect(isPasteShortcut(key("v", { metaKey: true }))).toBe(true);
    expect(isPasteShortcut(key("V", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isPasteShortcut(key("Insert", { shiftKey: true }))).toBe(true);
  });
  test("leaves typing, copy, and other chords to the remote browser", () => {
    expect(isPasteShortcut(key("v"))).toBe(false);
    expect(isPasteShortcut(key("c", { ctrlKey: true }))).toBe(false);
    expect(isPasteShortcut(key("v", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPasteShortcut(key("Insert", { ctrlKey: true }))).toBe(false);
  });
});

test("copy shortcuts use the local clipboard", () => {
  expect(isCopyShortcut(key("c", { ctrlKey: true }))).toBe(true);
  expect(isCopyShortcut(key("c", { metaKey: true }))).toBe(true);
  expect(isCopyShortcut(key("c"))).toBe(false);
  expect(isCopyShortcut(key("C", { ctrlKey: true, shiftKey: true }))).toBe(false);
  expect(isCopyShortcut(key("c", { ctrlKey: true, altKey: true }))).toBe(false);
});
