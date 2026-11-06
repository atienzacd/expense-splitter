import { describe, expect, it } from "vitest";
import { SplitError, splitByPercentage, splitEqually, splitExact, splitProportionally } from "../../src/lib/split.ts";

const sum = (shares: { amountOwed: number }[]) => shares.reduce((acc, s) => acc + s.amountOwed, 0);

describe("splitEqually", () => {
  it("splits evenly when the total divides cleanly", () => {
    expect(splitEqually(900, ["a", "b", "c"])).toEqual([
      { userId: "a", amountOwed: 300 },
      { userId: "b", amountOwed: 300 },
      { userId: "c", amountOwed: 300 },
    ]);
  });

  it("gives leftover centavos to the first people listed", () => {
    // ₱100.00 three ways: 3333 * 3 = 9999, one centavo left over.
    expect(splitEqually(10_000, ["a", "b", "c"]).map((s) => s.amountOwed)).toEqual([3334, 3333, 3333]);
    expect(splitEqually(10_001, ["a", "b", "c"]).map((s) => s.amountOwed)).toEqual([3334, 3334, 3333]);
  });

  it("always adds up to the total", () => {
    for (let total = 1; total <= 500; total++) {
      for (let people = 1; people <= 7; people++) {
        const ids = Array.from({ length: people }, (_, i) => `u${i}`);
        expect(sum(splitEqually(total, ids))).toBe(total);
      }
    }
  });

  it("handles a total smaller than the number of people", () => {
    expect(splitEqually(2, ["a", "b", "c"]).map((s) => s.amountOwed)).toEqual([1, 1, 0]);
  });

  it("handles amounts too large for plain number multiplication", () => {
    const total = Number.MAX_SAFE_INTEGER;
    expect(sum(splitEqually(total, ["a", "b", "c"]))).toBe(total);
  });

  it.each([0, -100, 10.5, Number.NaN, Infinity])("rejects an invalid total (%s)", (total) => {
    expect(() => splitEqually(total, ["a"])).toThrow(SplitError);
  });

  it("rejects an empty or duplicated list of people", () => {
    expect(() => splitEqually(100, [])).toThrow(SplitError);
    expect(() => splitEqually(100, ["a", "a"])).toThrow(SplitError);
  });
});

describe("splitExact", () => {
  it("accepts amounts that add up to the total", () => {
    const shares = [
      { userId: "a", amountOwed: 700 },
      { userId: "b", amountOwed: 300 },
    ];
    expect(splitExact(1000, shares)).toEqual(shares);
  });

  it("rejects amounts that do not add up to the total", () => {
    expect(() =>
      splitExact(1000, [
        { userId: "a", amountOwed: 700 },
        { userId: "b", amountOwed: 299 },
      ]),
    ).toThrow(/add up to 999/);
  });

  it("rejects zero, negative or fractional amounts", () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() =>
        splitExact(100, [
          { userId: "a", amountOwed: 100 - bad },
          { userId: "b", amountOwed: bad },
        ]),
      ).toThrow(SplitError);
    }
  });

  it("rejects duplicated people", () => {
    expect(() =>
      splitExact(100, [
        { userId: "a", amountOwed: 50 },
        { userId: "a", amountOwed: 50 },
      ]),
    ).toThrow(SplitError);
  });
});

describe("splitByPercentage", () => {
  it("splits by percentage and gives leftovers to the largest remainder", () => {
    // 50/30/20 of 10001 → 5000.5 / 3000.3 / 2000.2; the 0.5 wins the extra centavo.
    const shares = splitByPercentage(10_001, [
      { userId: "a", percent: 50 },
      { userId: "b", percent: 30 },
      { userId: "c", percent: 20 },
    ]);
    expect(shares.map((s) => s.amountOwed)).toEqual([5001, 3000, 2000]);
  });

  it("supports percentages with two decimals", () => {
    const shares = splitByPercentage(100, [
      { userId: "a", percent: 33.33 },
      { userId: "b", percent: 33.33 },
      { userId: "c", percent: 33.34 },
    ]);
    expect(shares.map((s) => s.amountOwed)).toEqual([33, 33, 34]);
  });

  it("always adds up to the total", () => {
    const percents = [12.5, 37.5, 25, 25];
    for (let total = 1; total <= 1000; total++) {
      const shares = splitByPercentage(
        total,
        percents.map((percent, i) => ({ userId: `u${i}`, percent })),
      );
      expect(sum(shares)).toBe(total);
    }
  });

  it("rejects percentages that do not add up to 100", () => {
    expect(() =>
      splitByPercentage(100, [
        { userId: "a", percent: 50 },
        { userId: "b", percent: 49.99 },
      ]),
    ).toThrow(/99.99%/);
  });

  it("rejects more than two decimal places", () => {
    expect(() =>
      splitByPercentage(100, [
        { userId: "a", percent: 33.333 },
        { userId: "b", percent: 66.667 },
      ]),
    ).toThrow(/2 decimal places/);
  });

  it("rejects zero or negative percentages", () => {
    expect(() =>
      splitByPercentage(100, [
        { userId: "a", percent: 100 },
        { userId: "b", percent: 0 },
      ]),
    ).toThrow(SplitError);
    expect(() =>
      splitByPercentage(100, [
        { userId: "a", percent: 110 },
        { userId: "b", percent: -10 },
      ]),
    ).toThrow(SplitError);
  });
});

describe("splitProportionally", () => {
  it("keeps each person's proportion and adds up to the new total", () => {
    // ¥1,000 split ¥700 / ¥300, converted to ₱397.56.
    const shares = splitProportionally(39_756, [
      { userId: "a", amountOwed: 700 },
      { userId: "b", amountOwed: 300 },
    ]);
    expect(shares).toEqual([
      { userId: "a", amountOwed: 27_829 },
      { userId: "b", amountOwed: 11_927 },
    ]);
    expect(sum(shares)).toBe(39_756);
  });

  it("always adds up to the total", () => {
    for (let total = 1; total <= 300; total++) {
      expect(sum(splitProportionally(total, [
        { userId: "a", amountOwed: 333 },
        { userId: "b", amountOwed: 333 },
        { userId: "c", amountOwed: 334 },
      ]))).toBe(total);
    }
  });

  it("rejects invalid shares", () => {
    expect(() => splitProportionally(100, [{ userId: "a", amountOwed: 0 }])).toThrow(SplitError);
    expect(() => splitProportionally(100, [])).toThrow(SplitError);
  });
});
