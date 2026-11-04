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
    // High enough that ordinary tests never hit them; the rate-limit tests lower them.
    globalRateLimit: { max: 10_000, timeWindow: "1 minute" },
    authRateLimit: { max: 1000, timeWindow: "1 minute" },
    ...overrides,
  });
  return { app, prisma };
}

export async function closeTestContext({ app, prisma }: TestContext): Promise<void> {
  await app.close();
  await prisma.$disconnect();
}

export type TestUser = { id: string; name: string; email: string; token: string; refreshToken: string };

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

/** Reads a cookie the server set on a response. */
export function cookieFrom(response: InjectResponse, name: string): string | undefined {
  return response.cookies.find((cookie) => cookie.name === name)?.value;
}

/** Registers a user through the API and returns their id and login cookies. */
export async function registerUser(app: FastifyInstance, name: string): Promise<TestUser> {
  const email = `${name.toLowerCase()}@example.com`;
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { name, email, password: "a-long-test-password" },
  });
  if (response.statusCode !== 201) throw new Error(`register ${name} failed: ${response.body}`);
  const { user } = response.json();
  return {
    ...user,
    token: cookieFrom(response, "access_token")!,
    refreshToken: cookieFrom(response, "refresh_token")!,
  };
}

/** Sends an authenticated request as `user`, with their access-token cookie. */
export function as(app: FastifyInstance, user: TestUser) {
  const send = (method: "GET" | "POST" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload, cookies: { access_token: user.token } });
  return {
    get: (url: string) => send("GET", url),
    post: (url: string, payload: object) => send("POST", url, payload),
    delete: (url: string) => send("DELETE", url),
  };
}

/** Adds `invitee` to a group the way people do: `inviter` invites them and they accept. */
export async function addMember(
  app: FastifyInstance,
  inviter: TestUser,
  groupId: string,
  invitee: TestUser,
): Promise<void> {
  const invite = await as(app, inviter).post(`/api/groups/${groupId}/invitations`, { email: invitee.email });
  if (invite.statusCode !== 202) throw new Error(`invite failed: ${invite.body}`);

  const { invitations } = (await as(app, invitee).get("/api/invitations")).json() as {
    invitations: { id: string; group: { id: string } }[];
  };
  const invitation = invitations.find((i) => i.group.id === groupId);
  if (!invitation) throw new Error("invitation not found");

  const accept = await as(app, invitee).post(`/api/invitations/${invitation.id}/accept`, {});
  if (accept.statusCode !== 200) throw new Error(`accept failed: ${accept.body}`);
}

/** Empties every table, so each test starts from a clean database. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE invitations, sessions, expense_splits, expenses, settlements, group_members, groups, users CASCADE",
  );
}
