import type { FastifyInstance } from "fastify";
import { buildApp, type AppOptions } from "../../src/app.ts";
import { createPrismaClient, type PrismaClient } from "../../src/db.ts";

/** A separate database so tests never touch your development data. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://splitter:splitter@localhost:5432/splitter_test";

export const TEST_JWT_SECRET = "integration-test-secret-at-least-32-chars";

export type TestContext = { app: FastifyInstance; prisma: PrismaClient };

export async function createTestContext(overrides: Partial<AppOptions> = {}): Promise<TestContext> {
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = await buildApp({
    prisma,
    jwtSecret: TEST_JWT_SECRET,
    // High enough that ordinary tests never hit it; the rate-limit test lowers it.
    authRateLimit: { max: 1000, timeWindow: "1 minute" },
    ...overrides,
  });
  return { app, prisma };
}

export async function closeTestContext({ app, prisma }: TestContext): Promise<void> {
  await app.close();
  await prisma.$disconnect();
}

/** Empties every table, so each test starts from a clean database. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE expense_splits, expenses, settlements, group_members, groups, users CASCADE",
  );
}
