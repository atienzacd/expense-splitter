import { describe, expect, it } from "vitest";
import { SettleError, computeBalances, simplifyDebts, type ExpenseRecord } from "../src/lib/settle.js";
import { splitEqually } from "../src/lib/split.js";

describe("computeBalances", () => {
  it("credits the payer and debits everyone in the split", () => {
    // Ana pays ₱30 dinner for three; Ben pays ₱6 for drinks for three.
    const balances = computeBalances([
      { paidById: "ana", amount: 3000, splits: splitEqually(3000, ["ana", "ben", "cara"]) },
      { paidById: "ben", amount: 600, splits: splitEqually(600, ["ana", "ben", "cara"]) },
    ]);
    expect(Object.fromEntries(balances)).toEqual({ ana: 1800, ben: -600, cara: -1200 });
  });

  it("applies settlements", () => {
    const balances = computeBalances(
      [{ paidById: "ana", amount: 1000, splits: splitEqually(1000, ["ana", "ben"]) }],
      [{ fromUserId: "ben", toUserId: "ana", amount: 500 }],
    );
    expect(Object.fromEntries(balances)).toEqual({ ana: 0, ben: 0 });
  });

  it("rejects an expense whose splits do not match its amount", () => {
    expect(() =>
      computeBalances([{ paidById: "ana", amount: 1000, splits: [{ userId: "ben", amountOwed: 999 }] }]),
    ).toThrow(SettleError);
  });
});

describe("simplifyDebts", () => {
  it("collapses a chain of debts into one payment", () => {
    // Ana owes Ben ₱5, Ben owes Cara ₱5 → Ana just pays Cara.
    const balances = computeBalances([
      { paidById: "ben", amount: 500, splits: [{ userId: "ana", amountOwed: 500 }] },
      { paidById: "cara", amount: 500, splits: [{ userId: "ben", amountOwed: 500 }] },
    ]);
    expect(simplifyDebts(balances)).toEqual([{ fromUserId: "ana", toUserId: "cara", amount: 500 }]);
  });

  it("matches the biggest debtor with the biggest creditor first", () => {
    const balances = new Map([
      ["ana", 1800],
      ["ben", -600],
      ["cara", -1200],
    ]);
    expect(simplifyDebts(balances)).toEqual([
      { fromUserId: "cara", toUserId: "ana", amount: 1200 },
      { fromUserId: "ben", toUserId: "ana", amount: 600 },
    ]);
  });

  it("returns no payments when everyone is settled", () => {
    expect(simplifyDebts(new Map([["ana", 0], ["ben", 0]]))).toEqual([]);
    expect(simplifyDebts(new Map())).toEqual([]);
  });

  it("rejects balances that do not add up to zero", () => {
    expect(() => simplifyDebts(new Map([["ana", 100], ["ben", -99]]))).toThrow(SettleError);
  });

  it("rejects fractional balances", () => {
    expect(() => simplifyDebts(new Map([["ana", 0.5], ["ben", -0.5]]))).toThrow(SettleError);
  });

  it("settles every random group in at most n - 1 payments", () => {
    // Seeded generator (mulberry32) so failures are reproducible.
    let seed = 42;
    const random = (max: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % max;
    };

    for (let round = 0; round < 200; round++) {
      const people = Array.from({ length: 2 + random(9) }, (_, i) => `p${i}`);
      const expenses: ExpenseRecord[] = Array.from({ length: 1 + random(15) }, () => {
        const amount = 1 + random(500_000);
        const splitWith = people.filter(() => random(2) === 0);
        const participants = splitWith.length > 0 ? splitWith : [people[0]!];
        return {
          paidById: people[random(people.length)]!,
          amount,
          splits: splitEqually(amount, participants),
        };
      });

      const balances = computeBalances(expenses);
      const transfers = simplifyDebts(balances);

      expect(transfers.length).toBeLessThanOrEqual(people.length - 1);
      const settled = computeBalances(expenses, transfers);
      for (const amount of settled.values()) expect(amount).toBe(0);
      for (const t of transfers) expect(t.amount).toBeGreaterThan(0);
    }
  });
});
