/**
 * Working out who owes whom inside a group.
 *
 * A person's net balance is what they paid minus what they owe. Positive means
 * the group owes them; negative means they owe the group. Balances in a group
 * always add up to zero.
 */

import type { Share } from "./split.js";

export type ExpenseRecord = { paidById: string; amount: number; splits: Share[] };
export type SettlementRecord = { fromUserId: string; toUserId: string; amount: number };
export type Transfer = { fromUserId: string; toUserId: string; amount: number };

export class SettleError extends Error {
  override name = "SettleError";
}

function add(balances: Map<string, number>, userId: string, delta: number): void {
  balances.set(userId, (balances.get(userId) ?? 0) + delta);
}

export function computeBalances(
  expenses: ExpenseRecord[],
  settlements: SettlementRecord[] = [],
): Map<string, number> {
  const balances = new Map<string, number>();

  for (const expense of expenses) {
    const owed = expense.splits.reduce((sum, s) => sum + s.amountOwed, 0);
    if (owed !== expense.amount) {
      throw new SettleError(`Expense splits add up to ${owed}, but the expense is ${expense.amount}`);
    }
    add(balances, expense.paidById, expense.amount);
    for (const split of expense.splits) {
      add(balances, split.userId, -split.amountOwed);
    }
  }

  // Paying someone back raises the payer's balance and lowers the receiver's.
  for (const settlement of settlements) {
    add(balances, settlement.fromUserId, settlement.amount);
    add(balances, settlement.toUserId, -settlement.amount);
  }

  return balances;
}

type Party = { userId: string; amount: number };

const largestFirst = (a: Party, b: Party): number =>
  b.amount - a.amount || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

/**
 * Turns net balances into a short list of payments that settles everyone.
 *
 * Greedy: repeatedly match the person who owes the most with the person owed
 * the most, and transfer the smaller of the two amounts. Each step settles at
 * least one person, so a group of n people needs at most n - 1 payments.
 * (Finding the absolute minimum number of payments is NP-hard; greedy is the
 * standard practical trade-off.)
 */
export function simplifyDebts(balances: Map<string, number>): Transfer[] {
  let total = 0;
  for (const [userId, amount] of balances) {
    if (!Number.isSafeInteger(amount)) {
      throw new SettleError(`Balance for ${userId} must be a whole number of centavos`);
    }
    total += amount;
  }
  if (total !== 0) {
    throw new SettleError(`Balances must add up to zero, but add up to ${total}`);
  }

  const creditors: Party[] = [];
  const debtors: Party[] = [];
  for (const [userId, amount] of balances) {
    if (amount > 0) creditors.push({ userId, amount });
    if (amount < 0) debtors.push({ userId, amount: -amount });
  }

  const transfers: Transfer[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(largestFirst);
    creditors.sort(largestFirst);
    const debtor = debtors[0]!;
    const creditor = creditors[0]!;

    const amount = Math.min(debtor.amount, creditor.amount);
    transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amount });

    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) debtors.shift();
    if (creditor.amount === 0) creditors.shift();
  }

  return transfers;
}
