import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppOptions } from "../../src/app.ts";
import type { PrismaClient } from "../../src/db.ts";
import { emailFingerprint } from "../../src/security.ts";

let app: FastifyInstance;
let logs: Record<string, unknown>[];

afterEach(async () => {
  await app.close();
});

// Captures the app's JSON log lines so tests can check what gets written.
async function build(overrides: Partial<AppOptions> = {}) {
  logs = [];
  app = await buildApp({
    prisma: {} as PrismaClient,
    jwtSecret: "unit-test-secret-that-is-at-least-32-chars",
    checkDatabase: async () => {},
    logger: { level: "info", stream: { write: (line) => logs.push(JSON.parse(line)) } },
    ...overrides,
  });
  return app;
}

const securityEvents = () => logs.filter((line) => line.securityEvent).map((line) => line.securityEvent);

describe("request limits", () => {
  it("rejects bodies over 16 KB", async () => {
    await build();
    app.post("/echo", async (request) => request.body);

    const response = await app.inject({ method: "POST", url: "/echo", payload: { text: "x".repeat(17_000) } });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: "PayloadTooLarge" });
  });

  it("rate limits every route per IP, and logs it", async () => {
    await build({ globalRateLimit: { max: 2, timeWindow: "1 minute" } });
    app.get("/ping", async () => "pong");

    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await app.inject({ method: "GET", url: "/ping" })).statusCode);

    expect(statuses).toEqual([200, 200, 429]);
    expect(securityEvents()).toContain("rate_limit.exceeded");
  });

  it("never rate limits the health check", async () => {
    await build({ globalRateLimit: { max: 1, timeWindow: "1 minute" } });
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    }
  });
});

describe("security logging", () => {
  it("logs rejected tokens with the reason", async () => {
    await build();
    await app.inject({ method: "GET", url: "/auth/me" });
    await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer forged.token.here" } });

    const rejected = logs.filter((line) => line.securityEvent === "auth.token_rejected");
    expect(rejected.map((line) => line.reason)).toEqual(["missing", "invalid_or_expired"]);
    expect(rejected[0]).toMatchObject({ level: 40, route: "/auth/me", ip: expect.any(String) });
  });

  it("redacts secrets from log lines", async () => {
    await build();
    app.get("/leaky", async (request) => {
      request.log.info({ password: "hunter2", user: { token: "abc.def.ghi", passwordHash: "$argon2id$..." } }, "oops");
      return "ok";
    });

    await app.inject({ method: "GET", url: "/leaky", headers: { authorization: "Bearer abc.def.ghi" } });

    const output = JSON.stringify(logs);
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("abc.def.ghi");
    expect(output).not.toContain("$argon2id$");
    expect(output).toContain("[Redacted]");
  });
});

describe("emailFingerprint", () => {
  it("is stable, short and doesn't reveal the address", () => {
    const fingerprint = emailFingerprint("ana@example.com");
    expect(fingerprint).toBe(emailFingerprint("ana@example.com"));
    expect(fingerprint).not.toBe(emailFingerprint("ben@example.com"));
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});
