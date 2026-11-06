/**
 * Invitations expire. Sign-up doesn't prove someone owns their email, so an
 * invitation to an address with no account yet could be claimed by whoever
 * registers that address first. Expiring invitations keeps that window short;
 * inviting the same address again starts a fresh week.
 */
export const INVITATION_TTL_DAYS = 7;

const TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Invitations created before this have expired. */
export function invitationCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - TTL_MS);
}

export function invitationExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TTL_MS);
}
