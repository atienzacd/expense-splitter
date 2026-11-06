import { api, post } from "./client.ts";

export type SplitType = "EQUAL" | "EXACT" | "PERCENTAGE";

export type Expense = {
  id: string;
  description: string;
  /** In the group's currency. */
  amount: number;
  /** What was actually paid, when it was in another currency, and the rate used to convert it. */
  original: { currency: string; amount: number; exchangeRate: string } | null;
  splitType: SplitType;
  createdAt: string;
  paidBy: { id: string; name: string };
  splits: { userId: string; amountOwed: number }[];
};

export type SplitInput =
  | { type: "EQUAL"; userIds: string[] }
  | { type: "EXACT"; shares: { userId: string; amount: number }[] }
  | { type: "PERCENTAGE"; shares: { userId: string; percent: number }[] };

export type NewExpense = {
  description: string;
  /** In minor units of `currency` (the group's own when left out). */
  amount: number;
  currency?: string;
  /** Needed when `currency` isn't the group's: 1 unit of it in the group's currency. */
  exchangeRate?: string;
  paidById: string;
  split: SplitInput;
};

export const listExpenses = async (groupId: string) =>
  (await api<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`)).expenses;

export const createExpense = (groupId: string, expense: NewExpense) =>
  post<{ expense: Expense }>(`/groups/${groupId}/expenses`, expense);

export const deleteExpense = (groupId: string, expenseId: string) =>
  api<void>(`/groups/${groupId}/expenses/${expenseId}`, { method: "DELETE" });
