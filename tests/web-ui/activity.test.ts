import { describe, expect, test } from "bun:test";
import { formatActivity, mergeActivity, type ActivityEntry } from "../../src/web-ui/activity.ts";

const entry = (seq: number, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  seq, ts: "2026-10-07T08:12:26.000Z", action: "click", detail: "e1", status: 200, ms: 42, source: "agent", ...extra,
});

describe("formatActivity", () => {
  test("formats a successful agent call", () => {
    const row = formatActivity(entry(1));
    expect(row).toMatchObject({ action: "click", detail: "e1", meta: "42ms", failed: false, fromDashboard: false });
    expect(row.time).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  test("shows seconds for slow calls", () => {
    expect(formatActivity(entry(1, { ms: 30_006 })).meta).toBe("30.0s");
  });

  test("flags failures with their status", () => {
    expect(formatActivity(entry(1, { status: 500, ms: 12 }))).toMatchObject({ failed: true, meta: "500 · 12ms" });
    expect(formatActivity(entry(1, { status: 399 })).failed).toBe(false);
  });

  test("marks dashboard calls", () => {
    expect(formatActivity(entry(1, { source: "dashboard" })).fromDashboard).toBe(true);
  });
});

describe("mergeActivity", () => {
  test("appends only entries newer than what is held", () => {
    const merged = mergeActivity([entry(1), entry(2)], [entry(2), entry(3)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  test("starts from empty", () => {
    expect(mergeActivity([], [entry(5)]).map((e) => e.seq)).toEqual([5]);
  });

  test("keeps only the newest max entries", () => {
    const merged = mergeActivity([entry(1), entry(2)], [entry(3), entry(4)], 3);
    expect(merged.map((e) => e.seq)).toEqual([2, 3, 4]);
  });
});
