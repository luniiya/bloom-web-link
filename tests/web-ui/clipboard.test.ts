import { describe, expect, test } from "bun:test";
import { selectedText } from "../../src/web-ui/clipboard.ts";

function read(doc: unknown): string {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  try { return selectedText(); }
  finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
}
describe("remote selection", () => {
  test("copies only the selected part of a field", () => {
    expect(read({ activeElement: { tagName: "INPUT", value: "hello world", selectionStart: 6, selectionEnd: 11 } })).toBe("world");
  });
  test("copies normal text selection", () => {
    expect(read({ activeElement: null, getSelection: () => ({ toString: () => "chosen text" }) })).toBe("chosen text");
  });
  test("empty field selection does not copy its whole value", () => {
    expect(read({ activeElement: { tagName: "TEXTAREA", value: "private", selectionStart: 2, selectionEnd: 2 } })).toBe("");
  });
  test("follows focused same-origin frames", () => {
    expect(read({ activeElement: { tagName: "IFRAME", contentDocument: { activeElement: null, getSelection: () => ({ toString: () => "frame selection" }) } } })).toBe("frame selection");
  });
});
