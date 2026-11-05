import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBalances, listSettlements, type NewPayment, recordPayment } from "../api/balances.ts";
import { groupKeys } from "../groups/queries.ts";

// Under the group's key, so adding or deleting an expense refreshes them too.
export const balanceKeys = {
  balances: (groupId: string) => [...groupKeys.detail(groupId), "balances"] as const,
  settlements: (groupId: string) => [...groupKeys.detail(groupId), "settlements"] as const,
};

export const useBalances = (groupId: string) =>
  useQuery({ queryKey: balanceKeys.balances(groupId), queryFn: () => getBalances(groupId) });

export const useSettlements = (groupId: string) =>
  useQuery({ queryKey: balanceKeys.settlements(groupId), queryFn: () => listSettlements(groupId) });

export function useRecordPayment(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payment: NewPayment) => recordPayment(groupId, payment),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) }),
  });
}
