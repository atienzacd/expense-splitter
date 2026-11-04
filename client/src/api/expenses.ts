import { api, post } from "./client.ts";

export type SplitType = "EQUAL" | "EXACT" | "PERCENTAGE";

export type Expense = {
  id: string;
  description: string;
  amount: number;
  splitType: SplitType;
  createdAt: string;
  paidBy: { id: string; name: string };
  splits: { userId: string; amountOwed: number }[];
};

export type SplitInput =
  | { type: "EQUAL"; userIds: string[] }
  | { type: "EXACT"; shares: { userId: string; amount: number }[] }
  | { type: "PERCENTAGE"; shares: { userId: string; percent: number }[] };

export type NewExpense = { description: string; amount: number; paidById: string; split: SplitInput };

export const listExpenses = async (groupId: string) =>
  (await api<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`)).expenses;

export const createExpense = (groupId: string, expense: NewExpense) =>
  post<{ expense: Expense }>(`/groups/${groupId}/expenses`, expense);

export const deleteExpense = (groupId: string, expenseId: string) =>
  api<void>(`/groups/${groupId}/expenses/${expenseId}`, { method: "DELETE" });
