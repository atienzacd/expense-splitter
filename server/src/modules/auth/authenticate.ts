import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../../db.ts";
import { logSecurityEvent } from "../../security.ts";
import { ACCESS_COOKIE } from "./cookies.ts";
import type { TokenSigner } from "./tokens.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `authenticate` on protected routes. */
    userId: string;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds a preHandler that only lets requests through with a valid access
 * token cookie whose login session is still active. Ending a session (logout,
 * refresh, or theft detection) therefore cuts off its access token at once,
 * instead of leaving it usable until it expires.
 */
export function createAuthenticate(tokens: TokenSigner, prisma: PrismaClient) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies[ACCESS_COOKIE];
    const claims = token ? await tokens.verify(token) : null;

    let reason: string | undefined;
    if (!token) {
      reason = "missing";
    } else if (!claims || !UUID.test(claims.userId) || !UUID.test(claims.sessionId)) {
      reason = "invalid_or_expired";
    } else {
      // The session must exist, belong to this user and not be ended; the user
      // is deleted along with their sessions, so this also covers deleted accounts.
      const session = await prisma.session.findFirst({
        where: { id: claims.sessionId, userId: claims.userId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (!session) reason = "session_ended";
    }

    if (reason) {
      logSecurityEvent(request, "auth.token_rejected", { reason, route: request.routeOptions.url });
      return reply.status(401).send({ error: "Unauthorized", message: "Log in to continue" });
    }
    request.userId = claims!.userId;
  };
}
