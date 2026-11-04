import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPrismaClient } from "./db.ts";

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);

const app = await buildApp({
  prisma,
  jwtSecret: config.JWT_SECRET,
  accessTokenTtl: config.ACCESS_TOKEN_TTL,
  refreshTokenTtl: config.REFRESH_TOKEN_TTL,
  allowedOrigins: config.ALLOWED_ORIGINS,
  cookieSecure: config.COOKIE_SECURE,
  trustProxy: config.TRUST_PROXY,
  logger: { level: config.LOG_LEVEL },
});

// Finish in-flight requests and close the database pool on Ctrl+C or `docker stop`.
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    // Without this, a failure while closing would be an unhandled rejection.
    app.log.error(error, "error during shutdown");
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

await app.listen({ host: config.HOST, port: config.PORT });
