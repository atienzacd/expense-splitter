import { HttpError } from "../errors.ts";

/**
 * Upper bounds that keep one person from making a group slow for everyone
 * else (every balance is worked out from all of a group's expenses and
 * payments). Generous for a group of friends: a two-week trip rarely has
 * more than a few hundred expenses.
 */
export const LIMITS = {
  /** People in a group, accounts and guests together. */
  membersPerGroup: 50,
  /** Invitations waiting for an answer in one group. */
  pendingInvitationsPerGroup: 50,
  expensesPerGroup: 5000,
  paymentsPerGroup: 5000,
  /** Groups one person can be in. */
  groupsPerUser: 100,
} as const;

export function limitReached(message: string): HttpError {
  return new HttpError(409, "LimitReached", message);
}
