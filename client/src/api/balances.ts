import { api, post } from "./client.ts";

/** A member's position: positive means the group owes them, negative means they owe. Centavos. */
export type Balance = { userId: string; name: string; isGuest: boolean; net: number };
/** One suggested payment from the debt simplification. */
export type Transfer = { fromUserId: string; toUserId: string; amount: number };
export type Settlement = { id: string; fromUserId: string; toUserId: string; amount: number; createdAt: string };

export const getBalances = (groupId: string) =>
  api<{ balances: Balance[]; transfers: Transfer[] }>(`/groups/${groupId}/balances`);

export const listSettlements = async (groupId: string) =>
  (await api<{ settlements: Settlement[] }>(`/groups/${groupId}/settlements`)).settlements;

export type NewPayment = { fromUserId?: string; toUserId: string; amount: number };

/** Records a payment: your own, or with `fromUserId` one a guest made (guests can't log in to do it). */
export const recordPayment = (groupId: string, payment: NewPayment) =>
  post<{ settlement: Settlement }>(`/groups/${groupId}/settlements`, payment);
