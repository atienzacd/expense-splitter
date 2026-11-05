import { SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestContext,
  cookieFrom,
  createTestContext,
  resetDatabase,
  TEST_JWT_SECRET,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await closeTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx.prisma);
});

const ana = { name: "Ana Santos", email: "ana@example.com", password: "correct-horse-battery" };

async function register(body: object = ana) {
  return ctx.app.inject({ method: "POST", url: "/api/auth/register", payload: body });
}

async function login(body: object) {
  return ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: body });
}

async function me(token?: string) {
  return ctx.app.inject({
    method: "GET",
    url: "/api/auth/me",
    cookies: token ? { access_token: token } : {},
  });
}

describe("POST /auth/register", () => {
  it("creates the user and logs them in with cookies, not a token in the body", async () => {
    const response = await register();

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user).toEqual({ id: expect.any(String), name: "Ana Santos", email: "ana@example.com" });
    expect(body.token).toBeUndefined();
    const token = cookieFrom(response, "access_token");
    expect(token).toEqual(expect.any(String));

    const profile = await me(token);
    expect(profile.json()).toEqual({ user: body.user });
  });

  it("never returns or stores the plain password", async () => {
    const response = await register();
    expect(response.body).not.toContain(ana.password);
    expect(response.body).not.toContain("passwordHash");

    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ana.email } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(ana.password);
  });

  it("normalizes the email", async () => {
    const response = await register({ ...ana, email: "  Ana@Example.COM " });
    expect(response.json().user.email).toBe("ana@example.com");
  });

  it("rejects a duplicate email, ignoring case", async () => {
    await register();
    const response = await register({ ...ana, email: "ANA@example.com" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "EmailTaken" });
  });

  it("validates the input", async () => {
    const response = await register({ name: "", email: "not-an-email", password: "short" });

    expect(response.statusCode).toBe(400);
    const paths = response.json().issues.map((issue: { path: string }) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "email", "password"]));
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await register();
  });

  it("logs in with the right password", async () => {
    const response = await login({ email: "ANA@example.com", password: ana.password });

    expect(response.statusCode).toBe(200);
    const { user, token } = response.json();
    expect(user.email).toBe("ana@example.com");
    expect(token).toBeUndefined();
    expect((await me(cookieFrom(response, "access_token"))).statusCode).toBe(200);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrongPassword = await login({ email: ana.email, password: "wrong-password" });
    const unknownEmail = await login({ email: "nobody@example.com", password: ana.password });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });
});

describe("GET /auth/me", () => {
  it("requires a token", async () => {
    const response = await me();
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("rejects an invalid token", async () => {
    expect((await me("not-a-real-token")).statusCode).toBe(401);
  });

  it("rejects the token of a user who no longer exists, on every protected route", async () => {
    const token = cookieFrom(await register(), "access_token");
    await resetDatabase(ctx.prisma);

    expect((await me(token)).statusCode).toBe(401);
    // Previously this reached the database and failed with a 500.
    const createGroup = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      payload: { name: "Ghost group" },
      cookies: { access_token: token! },
    });
    expect(createGroup.statusCode).toBe(401);
  });

  it("rejects an expired token on a group route", async () => {
    const { user } = (await register()).json();
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    // Everything valid except the expiry, so only that can be the reason it fails.
    const expired = await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer("expense-splitter")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/groups",
      cookies: { access_token: expired },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("rate limiting", () => {
  it("blocks repeated login attempts from the same address", async () => {
    const limited = await createTestContext({ authRateLimit: { max: 3, timeWindow: "1 minute" } });
    try {
      const attempt = () =>
        limited.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: ana.email, password: "guess" } });

      for (let i = 0; i < 3; i++) {
        expect((await attempt()).statusCode).toBe(401);
      }
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({ error: "TooManyRequests" });
      expect(blocked.headers["retry-after"]).toBeDefined();
    } finally {
      await closeTestContext(limited);
    }
  });

  it("blocks repeated sign-ups from the same address", async () => {
    const limited = await createTestContext({ authRateLimit: { max: 2, timeWindow: "1 minute" } });
    try {
      const statuses = [];
      for (const name of ["one", "two", "three"]) {
        const response = await limited.app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: { name, email: `${name}@example.com`, password: "a-long-test-password" },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses).toEqual([201, 201, 429]);
    } finally {
      await closeTestContext(limited);
    }
  });
});
