import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  as,
  closeTestContext,
  cookieFrom,
  createTestContext,
  registerUser,
  resetDatabase,
  type TestContext,
  type TestUser,
} from "./helpers.ts";

let ctx: TestContext;
const logs: Record<string, unknown>[] = [];

beforeAll(async () => {
  ctx = await createTestContext({
    allowedOrigins: ["https://splitter.example"],
    logger: { level: "info", stream: { write: (line) => logs.push(JSON.parse(line)) } },
  });
});

afterAll(async () => {
  await closeTestContext(ctx);
});

let ana: TestUser;

beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  logs.length = 0;
  ana = await registerUser(ctx.app, "Ana");
});

const refresh = (refreshToken?: string) =>
  ctx.app.inject({
    method: "POST",
    url: "/api/auth/refresh",
    cookies: refreshToken ? { refresh_token: refreshToken } : {},
  });

const me = (accessToken?: string) =>
  ctx.app.inject({ method: "GET", url: "/api/auth/me", cookies: accessToken ? { access_token: accessToken } : {} });

describe("login cookies", () => {
  it("are httpOnly, Secure and SameSite=Strict, scoped to the API", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ana.email, password: "a-long-test-password" },
    });

    const access = response.cookies.find((c) => c.name === "access_token");
    const refreshCookie = response.cookies.find((c) => c.name === "refresh_token");
    expect(access).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/api", maxAge: 15 * 60 });
    // The refresh token only travels to the auth routes that need it.
    expect(refreshCookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/api/auth",
      maxAge: 14 * 86_400,
    });
  });

  it("store only a hash of the refresh token", async () => {
    const sessions = await ctx.prisma.session.findMany({ where: { userId: ana.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).not.toBe(ana.refreshToken);
    expect(JSON.stringify(sessions)).not.toContain(ana.refreshToken);
  });
});

describe("POST /api/auth/refresh", () => {
  it("swaps the refresh token for a new pair of tokens", async () => {
    const response = await refresh(ana.refreshToken);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { id: ana.id, name: "Ana", email: ana.email } });
    const newAccess = cookieFrom(response, "access_token");
    const newRefresh = cookieFrom(response, "refresh_token");
    expect(newRefresh).toBeDefined();
    expect(newRefresh).not.toBe(ana.refreshToken);
    expect((await me(newAccess)).statusCode).toBe(200);
  });

  it("each refresh token works only once", async () => {
    await refresh(ana.refreshToken);
    const again = await refresh(ana.refreshToken);

    expect(again.statusCode).toBe(401);
    expect(again.json()).toMatchObject({ error: "SessionExpired" });
  });

  it("ends every session when an old refresh token is reused, as it may have been stolen", async () => {
    const first = await refresh(ana.refreshToken);
    const current = cookieFrom(first, "refresh_token")!;
    // Pretend the reuse happens later than the brief window allowed for two tabs refreshing at once.
    await ctx.prisma.session.updateMany({
      where: { userId: ana.id, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const reuse = await refresh(ana.refreshToken);
    expect(reuse.statusCode).toBe(401);
    // The legitimate, newer session is ended too.
    expect((await refresh(current)).statusCode).toBe(401);
    expect(await ctx.prisma.session.count({ where: { userId: ana.id, revokedAt: null } })).toBe(0);
    expect(logs.filter((line) => line.securityEvent === "auth.refresh_token_reused")).toEqual([
      expect.objectContaining({ userId: ana.id, level: 40 }),
    ]);
  });

  it("refuses an expired session", async () => {
    await ctx.prisma.session.updateMany({ where: { userId: ana.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refresh(ana.refreshToken)).statusCode).toBe(401);
  });

  it("refuses a missing or made-up refresh token, and clears the cookies", async () => {
    expect((await refresh()).statusCode).toBe(401);

    const response = await refresh("made-up-token");
    expect(response.statusCode).toBe(401);
    const cleared = response.cookies.find((c) => c.name === "refresh_token");
    expect(cleared?.value).toBe("");
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session on the server and clears the cookies", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { refresh_token: ana.refreshToken },
    });

    expect(response.statusCode).toBe(204);
    expect(response.cookies.map((c) => [c.name, c.value])).toEqual([
      ["access_token", ""],
      ["refresh_token", ""],
    ]);
    // The refresh token is dead even if someone kept a copy.
    expect((await refresh(ana.refreshToken)).statusCode).toBe(401);
    expect(logs.some((line) => line.securityEvent === "auth.logged_out" && line.userId === ana.id)).toBe(true);
  });

  it("only ends this device's session", async () => {
    const otherDevice = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ana.email, password: "a-long-test-password" },
    });
    await ctx.app.inject({ method: "POST", url: "/api/auth/logout", cookies: { refresh_token: ana.refreshToken } });

    expect((await refresh(cookieFrom(otherDevice, "refresh_token"))).statusCode).toBe(200);
  });

  it("succeeds even without a session", async () => {
    expect((await ctx.app.inject({ method: "POST", url: "/api/auth/logout" })).statusCode).toBe(204);
  });
});

describe("cross-site request protection", () => {
  const createGroup = (headers: Record<string, string>) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      payload: { name: "Trip" },
      cookies: { access_token: ana.token },
      headers,
    });

  it("allows changes from our own site", async () => {
    expect((await createGroup({ origin: "https://splitter.example", "sec-fetch-site": "same-origin" })).statusCode).toBe(
      201,
    );
  });

  it.each<Record<string, string>>([
    { origin: "https://evil.example" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    { origin: "https://evil.example", "sec-fetch-site": "same-origin" },
  ])("blocks changes from another site (%o)", async (headers) => {
    const response = await createGroup(headers);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "CrossSiteRequestBlocked" });
    expect(await ctx.prisma.group.count()).toBe(0);
    expect(logs.some((line) => line.securityEvent === "request.cross_site_blocked")).toBe(true);
  });

  it("doesn't block reads, which change nothing and still need the login cookie", async () => {
    const response = await as(ctx.app, ana).get("/api/groups");
    expect(response.statusCode).toBe(200);
  });

  it("protects logout too, so another site can't log you out", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { refresh_token: ana.refreshToken },
      headers: { origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(403);
    expect((await refresh(ana.refreshToken)).statusCode).toBe(200);
  });
});

describe("ending a session cuts off its access token at once", () => {
  it("after logout, the old access token no longer works", async () => {
    expect((await me(ana.token)).statusCode).toBe(200);
    await ctx.app.inject({ method: "POST", url: "/api/auth/logout", cookies: { refresh_token: ana.refreshToken } });

    // Someone who copied the cookie can't keep using it until it expires.
    expect((await me(ana.token)).statusCode).toBe(401);
    expect(logs.some((line) => line.securityEvent === "auth.token_rejected" && line.reason === "session_ended")).toBe(true);
  });

  it("after a refresh, the old access token is replaced by the new one", async () => {
    const response = await refresh(ana.refreshToken);
    expect((await me(ana.token)).statusCode).toBe(401);
    expect((await me(cookieFrom(response, "access_token"))).statusCode).toBe(200);
  });

  it("when a stolen refresh token is detected, every access token stops working", async () => {
    const otherDevice = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ana.email, password: "a-long-test-password" },
    });
    await refresh(ana.refreshToken);
    await ctx.prisma.session.updateMany({
      where: { userId: ana.id, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    await refresh(ana.refreshToken); // reuse → every session ends

    expect((await me(cookieFrom(otherDevice, "access_token"))).statusCode).toBe(401);
  });
});
