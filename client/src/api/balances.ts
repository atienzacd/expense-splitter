import { api, post } from "./client.ts";

/** A member's position: positive means the group owes them, negative means they owe. Centavos. */
export type Balance = { userId: string; name: string; net: number };
/** One suggested payment from the debt simplification. */
export type Transfer = { fromUserId: string; toUserId: string; amount: number };
export type Settlement = { id: string; fromUserId: string; toUserId: string; amount: number; createdAt: string };

export const getBalances = (groupId: string) =>
  api<{ balances: Balance[]; transfers: Transfer[] }>(`/groups/${groupId}/balances`);

export const listSettlements = async (groupId: string) =>
  (await api<{ settlements: Settlement[] }>(`/groups/${groupId}/settlements`)).settlements;

/** Records a payment the logged-in user made to another member. */
export const recordPayment = (groupId: string, payment: { toUserId: string; amount: number }) =>
  post<{ settlement: Settlement }>(`/groups/${groupId}/settlements`, payment);
