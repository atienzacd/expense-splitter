import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../../db.ts";
import { logSecurityEvent } from "../../security.ts";
import type { TokenSigner } from "./tokens.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `authenticate` on protected routes. */
    userId: string;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds a preHandler that only lets requests through with a valid
 * `Authorization: Bearer <token>` header for a user who still exists.
 */
export function createAuthenticate(tokens: TokenSigner, prisma: PrismaClient) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    const userId = token ? await tokens.verify(token) : null;

    let reason: string | undefined;
    if (!token) {
      reason = "missing";
    } else if (!userId || !UUID.test(userId)) {
      reason = "invalid_or_expired";
    } else if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      // A correctly signed token whose account is gone.
      reason = "unknown_user";
    }

    if (reason) {
      logSecurityEvent(request, "auth.token_rejected", { reason, route: request.routeOptions.url });
      return reply.status(401).send({ error: "Unauthorized", message: "Log in to continue" });
    }
    request.userId = userId!;
  };
}
