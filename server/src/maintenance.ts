import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "./db.ts";
import { invitationCutoff } from "./modules/invitations/expiry.ts";

/**
 * Removes data that has stopped being useful (ISO 27001 Annex A 8.10
 * Information deletion):
 * - login sessions a day after they expired. Used and logged-out sessions are
 *   kept until then, because reuse detection needs them.
 * - invitations once they've expired.
 * - guests nothing refers to any more: removed from their group, and with no
 *   expenses or payments left (e.g. after the group was closed).
 */
export async function cleanUpExpiredData(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ sessions: number; invitations: number; guests: number }> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: dayAgo } } });
  const invitations = await prisma.invitation.deleteMany({ where: { createdAt: { lte: invitationCutoff(now) } } });
  const guests = await prisma.user.deleteMany({
    where: {
      isGuest: true,
      memberships: { none: {} },
      expensesPaid: { none: {} },
      splits: { none: {} },
      settlementsPaid: { none: {} },
      settlementsReceived: { none: {} },
    },
  });
  return { sessions: sessions.count, invitations: invitations.count, guests: guests.count };
}

const HOUR_MS = 60 * 60 * 1000;

/** Cleans up now and then every hour. Returns a function that stops it. */
export function scheduleCleanUp(prisma: PrismaClient, log: FastifyBaseLogger, intervalMs: number = HOUR_MS): () => void {
  const run = () => {
    cleanUpExpiredData(prisma).then(
      (removed) => log.info({ removed }, "expired data cleaned up"),
      (error: unknown) => log.error(error, "cleaning up expired data failed"),
    );
  };
  run();
  const timer = setInterval(run, intervalMs);
  // Never keeps the process alive on its own.
  timer.unref();
  return () => clearInterval(timer);
}
