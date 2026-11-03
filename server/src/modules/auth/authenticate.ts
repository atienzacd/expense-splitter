import type { FastifyReply, FastifyRequest } from "fastify";
import { logSecurityEvent } from "../../security.ts";
import type { TokenSigner } from "./tokens.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `authenticate` on protected routes. */
    userId: string;
  }
}

/**
 * Builds a preHandler that only lets requests with a valid
 * `Authorization: Bearer <token>` header through.
 */
export function createAuthenticate(tokens: TokenSigner) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    const userId = token ? await tokens.verify(token) : null;

    if (!userId) {
      logSecurityEvent(request, "auth.token_rejected", {
        reason: token ? "invalid_or_expired" : "missing",
        route: request.routeOptions.url,
      });
      return reply.status(401).send({ error: "Unauthorized", message: "Log in to continue" });
    }
    request.userId = userId;
  };
}
