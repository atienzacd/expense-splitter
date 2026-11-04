import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../../db.ts";

/**
 * Refresh-token sessions.
 *
 * A refresh token is a random value that lets the browser get a new
 * short-lived access token. Only its SHA-256 hash is stored. Every refresh
 * swaps it for a new one ("rotation"), so each token works once. If an
 * already-used token comes back, someone may have copied it, so every session
 * of that user is ended ("reuse detection").
 */

const TOKEN_BYTES = 32;
// Two tabs refreshing at the same moment both send the same token; the second
// is turned away without ending every session (cookies are shared between
// tabs, so it already has the new one).
const REUSE_GRACE_MS = 30_000;

export type RefreshOutcome =
  | { status: "rotated"; userId: string; token: string; expiresAt: Date }
  | { status: "reused"; userId: string }
  | { status: "invalid" };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  prisma: PrismaClient,
  userId: string,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function rotateSession(prisma: PrismaClient, token: string, ttlSeconds: number): Promise<RefreshOutcome> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session) return { status: "invalid" };

  const now = Date.now();
  if (session.revokedAt) {
    if (now - session.revokedAt.getTime() < REUSE_GRACE_MS) return { status: "invalid" };
    await revokeAllSessions(prisma, session.userId);
    return { status: "reused", userId: session.userId };
  }
  if (session.expiresAt.getTime() <= now) return { status: "invalid" };

  // Only the request that actually marks the session as used may continue,
  // so the same token can't be exchanged twice at once.
  const { count } = await prisma.session.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date(now) },
  });
  if (count === 0) return { status: "invalid" };

  const next = await createSession(prisma, session.userId, ttlSeconds);
  return { status: "rotated", userId: session.userId, ...next };
}

/** Ends the session behind `token`, if any. */
export async function revokeSession(prisma: PrismaClient, token: string): Promise<string | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, userId: true } });
  if (!session) return null;
  await prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
  return session.userId;
}

export async function revokeAllSessions(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
