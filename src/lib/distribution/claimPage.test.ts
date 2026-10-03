import { describe, expect, it } from "vitest";
import { predicateOpen } from "./claimPage";

const now = new Date("2026-10-03T12:00:00Z");
const created = new Date("2026-10-03T11:00:00Z");

describe("predicateOpen", () => {
  it("handles the shapes Sendall creates", () => {
    const before = { abs_before: "2026-10-10T00:00:00Z" };
    expect(predicateOpen(before, now, created)).toBe(true); // recipient, inside the window
    expect(predicateOpen({ not: before }, now, created)).toBe(false); // sender, too early
    const past = { abs_before: "2026-10-01T00:00:00Z" };
    expect(predicateOpen(past, now, created)).toBe(false);
    expect(predicateOpen({ not: past }, now, created)).toBe(true); // sender can reclaim
  });

  it("handles the rest of the predicate language", () => {
    expect(predicateOpen({ unconditional: true }, now, created)).toBe(true);
    expect(predicateOpen({ rel_before: "7200" }, now, created)).toBe(true); // created + 2h > now
    expect(predicateOpen({ rel_before: "1800" }, now, created)).toBe(false);
    expect(predicateOpen({ and: [{ unconditional: true }, { rel_before: "1800" }] }, now, created)).toBe(false);
    expect(predicateOpen({ or: [{ unconditional: true }, { rel_before: "1800" }] }, now, created)).toBe(true);
    expect(predicateOpen({}, now, created)).toBe(false);
  });
});
