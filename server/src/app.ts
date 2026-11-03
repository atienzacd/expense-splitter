import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import { SettleError } from "./lib/settle.ts";
import { SplitError } from "./lib/split.ts";

export type AppOptions = {
  /** Resolves if the database is reachable, rejects otherwise. */
  checkDatabase: () => Promise<void>;
  logger?: FastifyServerOptions["logger"];
};

/**
 * Builds the Fastify app without starting it, so tests can call
 * `app.inject()` without opening a network port.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(helmet);

  // Every error response has the same shape: { error, message, issues? }.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        message: "The request is invalid",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    if (error instanceof SplitError || error instanceof SettleError) {
      return reply.status(400).send({ error: error.name, message: error.message });
    }
    if (error instanceof Error && "statusCode" in error) {
      const statusCode = Number(error.statusCode);
      if (statusCode >= 400 && statusCode < 500) {
        return reply.status(statusCode).send({ error: "BadRequest", message: error.message });
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
      await options.checkDatabase();
      return { status: "ok", database: "ok" };
    } catch (error) {
      request.log.error(error, "database health check failed");
      return reply.status(503).send({ status: "error", database: "unreachable" });
    }
  });

  return app;
}
