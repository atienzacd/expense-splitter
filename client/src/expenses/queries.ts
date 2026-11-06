import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createExpense, deleteExpense, listExpenses, type NewExpense } from "../api/expenses.ts";
import { getRate } from "../api/rates.ts";
import type { Currency } from "../lib/money.ts";
import { groupKeys } from "../groups/queries.ts";

export const expenseKeys = {
  list: (groupId: string) => [...groupKeys.detail(groupId), "expenses"] as const,
};

export const useExpenses = (groupId: string) =>
  useQuery({ queryKey: expenseKeys.list(groupId), queryFn: () => listExpenses(groupId) });

/** Anything under the group's cache key (expenses now, balances later) is refreshed after a change. */
function useRefreshGroup(groupId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) });
}

export function useAddExpense(groupId: string) {
  const refresh = useRefreshGroup(groupId);
  return useMutation({ mutationFn: (expense: NewExpense) => createExpense(groupId, expense), onSuccess: refresh });
}

export function useDeleteExpense(groupId: string) {
  const refresh = useRefreshGroup(groupId);
  return useMutation({ mutationFn: (expenseId: string) => deleteExpense(groupId, expenseId), onSuccess: refresh });
}

/** A suggested rate for converting `from` into the group's currency. Rates change daily, so an hour is fresh enough. */
export const useExchangeRate = (from: Currency, to: Currency) =>
  useQuery({
    queryKey: ["rates", from, to],
    queryFn: () => getRate(from, to),
    enabled: from !== to,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
