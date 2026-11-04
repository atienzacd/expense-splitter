import { describe, expect, it } from "vitest";
import { buildExpense, type ExpenseFormValues, percentToBasisPoints } from "./buildExpense.ts";

const members = ["ana", "ben", "cara"];

const base = (overrides: Partial<ExpenseFormValues> = {}): ExpenseFormValues => ({
  description: "Dinner",
  amount: "300",
  paidById: "ana",
  splitType: "EQUAL",
  included: { ana: true, ben: true, cara: true },
  exact: {},
  percent: {},
  ...overrides,
});

describe("buildExpense", () => {
  it("builds an equal split between the chosen people, in centavos", () => {
    expect(buildExpense(base({ included: { ana: true, ben: false, cara: true } }), members)).toEqual({
      ok: true,
      expense: { description: "Dinner", amount: 30_000, paidById: "ana", split: { type: "EQUAL", userIds: ["ana", "cara"] } },
    });
  });

  it("asks for a description, a valid amount and at least one person", () => {
    const result = buildExpense(base({ description: "  ", amount: "abc", included: {} }), members);
    expect(result).toEqual({
      ok: false,
      errors: {
        description: "Describe the expense",
        amount: "Enter an amount like 150 or 150.75",
        split: "Choose at least one person to split with",
      },
    });
  });

  it("builds exact amounts, skipping people left blank", () => {
    const result = buildExpense(base({ splitType: "EXACT", exact: { ana: "200", ben: "", cara: "100.00" } }), members);
    expect(result).toMatchObject({
      ok: true,
      expense: {
        split: {
          type: "EXACT",
          shares: [
            { userId: "ana", amount: 20_000 },
            { userId: "cara", amount: 10_000 },
          ],
        },
      },
    });
  });

  it("refuses exact amounts that don't add up to the total", () => {
    const result = buildExpense(base({ splitType: "EXACT", exact: { ana: "200", ben: "99.99" } }), members);
    expect(result).toEqual({ ok: false, errors: { split: "The amounts must add up to the total" } });
  });

  it("builds percentages that add up to exactly 100", () => {
    const result = buildExpense(
      base({ splitType: "PERCENTAGE", percent: { ana: "33.33", ben: "33.33", cara: "33.34" } }),
      members,
    );
    expect(result).toMatchObject({
      ok: true,
      expense: {
        split: {
          type: "PERCENTAGE",
          shares: [
            { userId: "ana", percent: 33.33 },
            { userId: "ben", percent: 33.33 },
            { userId: "cara", percent: 33.34 },
          ],
        },
      },
    });
  });

  it("refuses percentages that don't add up to 100 or have too many decimals", () => {
    expect(buildExpense(base({ splitType: "PERCENTAGE", percent: { ana: "50", ben: "40" } }), members)).toMatchObject({
      ok: false,
      errors: { split: "The percentages must add up to 100%" },
    });
    expect(buildExpense(base({ splitType: "PERCENTAGE", percent: { ana: "33.333" } }), members)).toMatchObject({
      ok: false,
      errors: { split: "Use percentages like 50 or 33.33" },
    });
  });
});

describe("percentToBasisPoints", () => {
  it("counts in hundredths of a percent, so sums are exact", () => {
    expect(percentToBasisPoints("33.33")).toBe(3333);
    expect(percentToBasisPoints("0.1")).toBe(10);
    expect(percentToBasisPoints("100")).toBe(10_000);
    expect(percentToBasisPoints("1.234")).toBeNull();
  });
});
