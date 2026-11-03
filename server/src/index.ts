import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPrismaClient } from "./db.ts";

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);

const app = await buildApp({
  prisma,
  jwtSecret: config.JWT_SECRET,
  jwtExpiresIn: config.JWT_EXPIRES_IN,
  trustProxy: config.TRUST_PROXY,
  logger: { level: config.LOG_LEVEL },
});

// Finish in-flight requests and close the database pool on Ctrl+C or `docker stop`.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
