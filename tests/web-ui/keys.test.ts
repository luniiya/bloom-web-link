import { describe, expect, test } from "bun:test";
import { keyToPress, type KeyLike } from "../../src/web-ui/keys.ts";

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
