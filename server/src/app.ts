import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { PrismaClient } from "./db.ts";
import { HttpError } from "./errors.ts";
import { createEmailFingerprinter, logSecurityEvent, REDACTED_LOG_PATHS } from "./security.ts";
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
  /** Requests allowed per IP across the whole API (health checks excluded). */
  globalRateLimit?: RateLimit;
  /** Attempts allowed per IP on login, register and adding members by email. */
  authRateLimit?: RateLimit;
  /**
   * Addresses of reverse proxies to trust, so rate limits see real client IPs.
   * Deliberately never `true`, which would trust headers the client wrote.
   */
  trustProxy?: false | string;
  logger?: false | { level: string; stream?: { write(line: string): void } };
};

type RateLimit = { max: number; timeWindow: string };

// Requests carry small JSON only; anything larger is rejected before parsing.
const BODY_LIMIT_BYTES = 16 * 1024;
// Slow or stalled requests are cut off instead of holding a connection open.
const REQUEST_TIMEOUT_MS = 30_000;

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

  const app = Fastify({
    logger: options.logger ? { ...options.logger, redact: { paths: REDACTED_LOG_PATHS } } : false,
    bodyLimit: BODY_LIMIT_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
    trustProxy: options.trustProxy ?? false,
  });

  await app.register(helmet);
  // A generous limit on every route; login and similar routes set stricter ones.
  const globalRateLimit = options.globalRateLimit ?? { max: 300, timeWindow: "1 minute" };
  await app.register(rateLimit, {
    ...globalRateLimit,
    onExceeded: (request) => logSecurityEvent(request, "rate_limit.exceeded", { route: request.routeOptions.url }),
  });

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
      if (error.code === "GroupNotFound") {
        logSecurityEvent(request, "access.denied", { userId: request.userId, route: request.routeOptions.url });
      }
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    // Bad split input is the client's mistake. (A SettleError means stored data
    // doesn't add up, so it falls through to the logged 500 below.)
    if (error instanceof SplitError) {
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

  // Rate limited like real routes, so probing unknown URLs isn't free. The URL
  // isn't echoed back, so nothing the client sent is reflected in the response.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (_request, reply) =>
    reply.status(404).send({ error: "NotFound", message: "Not found" }),
  );

  // Monitoring polls this often, so it is exempt from rate limiting.
  app.get("/api/health", { config: { rateLimit: false } }, async (request, reply) => {
    try {
      await checkDatabase();
      return { status: "ok", database: "ok" };
    } catch (error) {
      request.log.error(error, "database health check failed");
      return reply.status(503).send({ status: "error", database: "unreachable" });
    }
  });

  const tokens = createTokenSigner(options.jwtSecret, options.jwtExpiresIn ?? "1d");
  const authenticate = createAuthenticate(tokens, prisma);
  const authRateLimit = options.authRateLimit ?? { max: 10, timeWindow: "1 minute" };
  app.decorateRequest("userId", "");

  await app.register(authRoutes, {
    prefix: "/api/auth",
    prisma,
    tokens,
    authenticate,
    rateLimit: authRateLimit,
    fingerprintEmail: createEmailFingerprinter(options.jwtSecret),
  });

  // Everything under /api/groups requires a logged-in user.
  await app.register(
    async (groups) => {
      groups.addHook("preHandler", authenticate);
      await groups.register(groupRoutes, { prisma, lookupRateLimit: authRateLimit });
      await groups.register(expenseRoutes, { prisma });
      await groups.register(balanceRoutes, { prisma });
    },
    { prefix: "/api/groups" },
  );

  return app;
}
