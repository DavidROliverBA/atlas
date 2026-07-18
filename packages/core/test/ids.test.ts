import { describe, expect, it } from "vitest";
import { isUlid, seededUlidFactory, ulidFactory } from "../src/ids.js";

describe("ULIDs", () => {
  it("generates valid 26-char Crockford base32 ids", () => {
    const ids = ulidFactory();
    for (let i = 0; i < 100; i++) {
      expect(isUlid(ids.next())).toBe(true);
    }
  });

  it("is monotonic within the same millisecond", () => {
    const ids = ulidFactory({ now: () => 1_700_000_000_000 });
    const out = Array.from({ length: 1000 }, () => ids.next());
    const sorted = [...out].sort();
    expect(out).toEqual(sorted);
    expect(new Set(out).size).toBe(out.length);
  });

  it("seeded factory is fully deterministic", () => {
    const a = seededUlidFactory(7);
    const b = seededUlidFactory(7);
    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });
});
