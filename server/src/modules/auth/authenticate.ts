import type { FastifyReply, FastifyRequest } from "fastify";
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
      return reply.status(401).send({ error: "Unauthorized", message: "Log in to continue" });
    }
    request.userId = userId;
  };
}
