import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import type { PrismaClient } from "./db.ts";
import { HttpError } from "./errors.ts";
import { SettleError } from "./lib/settle.ts";
import { SplitError } from "./lib/split.ts";
import { createAuthenticate } from "./modules/auth/authenticate.ts";
import { authRoutes } from "./modules/auth/routes.ts";
import { createTokenSigner } from "./modules/auth/tokens.ts";
import { balanceRoutes } from "./modules/balances/routes.ts";
import { expenseRoutes } from "./modules/expenses/routes.ts";
import { groupRoutes } from "./modules/groups/routes.ts";

export type AppOptions = {
  prisma: PrismaClient;
  jwtSecret: string;
  jwtExpiresIn?: string;
  /** Resolves if the database is reachable, rejects otherwise. Defaults to a `SELECT 1`. */
  checkDatabase?: () => Promise<void>;
  /** Attempts allowed per IP on login and register. */
  authRateLimit?: { max: number; timeWindow: string };
  logger?: FastifyServerOptions["logger"];
};

const CLIENT_ERROR_NAMES: Record<number, string> = {
  413: "PayloadTooLarge",
  415: "UnsupportedMediaType",
  429: "TooManyRequests",
};

/**
 * Builds the Fastify app without starting it, so tests can call
 * `app.inject()` without opening a network port.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { prisma } = options;
  const checkDatabase =
    options.checkDatabase ??
    (async () => {
      await prisma.$queryRaw`SELECT 1`;
    });

  const app = Fastify({ logger: options.logger ?? false });

  await app.register(helmet);
  // Off by default; individual routes such as login opt in.
  await app.register(rateLimit, { global: false });

  // Every error response has the same shape: { error, message, issues? }.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        message: "The request is invalid",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof SplitError || error instanceof SettleError) {
      return reply.status(400).send({ error: error.name, message: error.message });
    }
    if (error instanceof Error && "statusCode" in error) {
      const statusCode = Number(error.statusCode);
      if (statusCode >= 400 && statusCode < 500) {
        const name = CLIENT_ERROR_NAMES[statusCode] ?? "BadRequest";
        return reply.status(statusCode).send({ error: name, message: error.message });
      }
    }
    // Unexpected errors are logged in full but never leaked to the client.
    request.log.error(error);
    return reply.status(500).send({ error: "InternalServerError", message: "Something went wrong" });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: "NotFound", message: `Route ${request.method} ${request.url} not found` }),
  );

  app.get("/health", async (request, reply) => {
    try {
      await checkDatabase();
      return { status: "ok", database: "ok" };
    } catch (error) {
      request.log.error(error, "database health check failed");
      return reply.status(503).send({ status: "error", database: "unreachable" });
    }
  });

  const tokens = createTokenSigner(options.jwtSecret, options.jwtExpiresIn ?? "1d");
  const authenticate = createAuthenticate(tokens);
  const authRateLimit = options.authRateLimit ?? { max: 10, timeWindow: "1 minute" };
  app.decorateRequest("userId", "");

  await app.register(authRoutes, { prefix: "/auth", prisma, tokens, authenticate, rateLimit: authRateLimit });

  // Everything under /groups requires a logged-in user.
  await app.register(
    async (groups) => {
      groups.addHook("preHandler", authenticate);
      await groups.register(groupRoutes, { prisma, lookupRateLimit: authRateLimit });
      await groups.register(expenseRoutes, { prisma });
      await groups.register(balanceRoutes, { prisma });
    },
    { prefix: "/groups" },
  );

  return app;
}
