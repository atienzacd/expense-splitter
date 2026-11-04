import type { NewExpense, SplitType } from "../api/expenses.ts";
import { parsePesos } from "../lib/money.ts";

/** What the add-expense form holds: raw text, exactly as typed. */
export type ExpenseFormValues = {
  description: string;
  amount: string;
  paidById: string;
  splitType: SplitType;
  /** EQUAL: who shares the cost. */
  included: Record<string, boolean>;
  /** EXACT: each person's amount in pesos; blank means they owe nothing. */
  exact: Record<string, string>;
  /** PERCENTAGE: each person's percentage; blank means 0%. */
  percent: Record<string, string>;
};

export type ExpenseFormErrors = { description?: string; amount?: string; split?: string };

export type BuildResult = { ok: true; expense: NewExpense } | { ok: false; errors: ExpenseFormErrors };

const PERCENT = /^\d{1,3}(?:\.\d{1,2})?$/;

/** Percentages as whole hundredths (33.33% → 3333), so they add up exactly. */
export function percentToBasisPoints(input: string): number | null {
  const value = input.trim();
  if (!PERCENT.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * Checks the form the same way the server will, so mistakes show next to the
 * field instead of coming back as an error after submitting.
 */
export function buildExpense(values: ExpenseFormValues, memberIds: string[]): BuildResult {
  const errors: ExpenseFormErrors = {};
  const description = values.description.trim();
  if (!description) errors.description = "Describe the expense";
  else if (description.length > 200) errors.description = "Use at most 200 characters";

  const amount = parsePesos(values.amount);
  if (amount === null) errors.amount = "Enter an amount like 150 or 150.75";

  let split: NewExpense["split"] | undefined;
  if (values.splitType === "EQUAL") {
    const userIds = memberIds.filter((id) => values.included[id]);
    if (userIds.length === 0) errors.split = "Choose at least one person to split with";
    else split = { type: "EQUAL", userIds };
  } else if (values.splitType === "EXACT") {
    const shares: { userId: string; amount: number }[] = [];
    for (const userId of memberIds) {
      const typed = values.exact[userId]?.trim() ?? "";
      if (!typed) continue;
      const share = parsePesos(typed);
      if (share === null) {
        errors.split = "Each amount must be like 150 or 150.75";
        break;
      }
      shares.push({ userId, amount: share });
    }
    const assigned = shares.reduce((sum, share) => sum + share.amount, 0);
    if (!errors.split && shares.length === 0) errors.split = "Enter how much each person owes";
    else if (!errors.split && amount !== null && assigned !== amount) {
      errors.split = "The amounts must add up to the total";
    }
    if (!errors.split) split = { type: "EXACT", shares };
  } else {
    const shares: { userId: string; percent: number }[] = [];
    let basisPoints = 0;
    for (const userId of memberIds) {
      const typed = values.percent[userId]?.trim() ?? "";
      if (!typed) continue;
      const points = percentToBasisPoints(typed);
      if (points === null) {
        errors.split = "Use percentages like 50 or 33.33";
        break;
      }
      if (points === 0) continue;
      basisPoints += points;
      shares.push({ userId, percent: points / 100 });
    }
    if (!errors.split && basisPoints !== 10_000) errors.split = "The percentages must add up to 100%";
    if (!errors.split) split = { type: "PERCENTAGE", shares };
  }

  if (Object.keys(errors).length > 0 || amount === null || !split) return { ok: false, errors };
  return { ok: true, expense: { description, amount, paidById: values.paidById, split } };
}
