import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`../../src/web-ui/${name}`, import.meta.url), "utf8");
const html = read("index.html");

describe("index.html", () => {
  test("no <p> contains block-level children (the browser would split it)", () => {
    // Regression: <p hidden><h2>Tab closed</h2></p> left "Tab closed" visible on open tabs.
    for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
      expect(match[1]).not.toMatch(/<(h[1-6]|p|div|section|article|ul|ol)\b/);
    }
  });

  test("the closed-tab notice is one hidden element holding its heading", () => {
    expect(html).toMatch(/<div id="detail-missing"[^>]*\bhidden\b[^>]*>\s*<h2>Tab closed<\/h2>/);
  });

  test("has the activity log panel", () => {
    expect(html).toContain('id="activity-list"');
    expect(html).toContain('id="activity-empty"');
  });

  test("uses SVG icons, not text glyphs, for arrows and markers", () => {
    for (const file of ["index.html", "client.ts", "styles.css"]) {
      expect(read(file)).not.toMatch(/[←→↑↓◢◣◤◥●▶◀]|&larr;|&rarr;/);
    }
    expect(html).toMatch(/<button id="back-button"[^>]*><svg class="icon"/);
  });

  test("every id the client looks up exists in the page", () => {
    const ids = [...read("client.ts").matchAll(/querySelector<[^>]+>\("#([\w-]+)"\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
  });
});
