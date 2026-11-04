import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppOptions } from "../../src/app.ts";
import type { PrismaClient } from "../../src/db.ts";
import { createEmailFingerprinter } from "../../src/security.ts";

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
    // Returns a fixed response: test routes never reflect input back (CodeQL js/reflected-xss).
    app.post("/upload", async () => ({ ok: true }));

    const response = await app.inject({ method: "POST", url: "/upload", payload: { text: "x".repeat(17_000) } });

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

  it("rate limits unknown URLs too, without echoing them back", async () => {
    await build({ globalRateLimit: { max: 2, timeWindow: "1 minute" } });

    const responses = [];
    for (let i = 0; i < 3; i++) responses.push(await app.inject({ method: "GET", url: `/probe-${i}?q=<script>` }));

    expect(responses.map((r) => r.statusCode)).toEqual([404, 404, 429]);
    expect(responses[0]?.json()).toEqual({ error: "NotFound", message: "Not found" });
  });

  it("gives the health check its own higher limit, and queries the database at most once per burst", async () => {
    let databaseChecks = 0;
    await build({
      globalRateLimit: { max: 1, timeWindow: "1 minute" },
      checkDatabase: async () => {
        databaseChecks++;
      },
    });

    const statuses = [];
    for (let i = 0; i < 121; i++) statuses.push((await app.inject({ method: "GET", url: "/api/health" })).statusCode);

    // Not held to the global limit of 1, but not unlimited either.
    expect(statuses.slice(0, 120).every((status) => status === 200)).toBe(true);
    expect(statuses[120]).toBe(429);
    expect(databaseChecks).toBe(1);
  });
});

describe("client IP behind a proxy", () => {
  const ping = (remoteAddress: string, forwardedFor?: string) =>
    app.inject({
      method: "GET",
      url: "/ping",
      remoteAddress,
      headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
    });

  it("ignores X-Forwarded-For when no proxy is trusted", async () => {
    await build({ globalRateLimit: { max: 2, timeWindow: "1 minute" } });
    app.get("/ping", async (request) => ({ ip: request.ip }));

    // A client rotating fake addresses still shares one rate-limit bucket.
    const statuses = [];
    for (const fake of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) statuses.push((await ping("203.0.113.5", fake)).statusCode);
    expect(statuses).toEqual([200, 200, 429]);
  });

  it("behind a trusted proxy, uses the address the proxy saw, not one the client wrote", async () => {
    await build({ trustProxy: "127.0.0.1", globalRateLimit: { max: 2, timeWindow: "1 minute" } });
    app.get("/ping", async (request) => ({ ip: request.ip }));

    // The proxy appends the real client address (198.51.100.7) after whatever the client sent.
    const first = await ping("127.0.0.1", "6.6.6.6, 198.51.100.7");
    expect(first.json()).toEqual({ ip: "198.51.100.7" });

    const statuses = [first.statusCode];
    for (const fake of ["7.7.7.7", "8.8.8.8"]) {
      statuses.push((await ping("127.0.0.1", `${fake}, 198.51.100.7`)).statusCode);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });

  it("ignores X-Forwarded-For from a client that isn't the trusted proxy", async () => {
    await build({ trustProxy: "127.0.0.1" });
    app.get("/ping", async (request) => ({ ip: request.ip }));

    const response = await ping("203.0.113.5", "6.6.6.6");
    expect(response.json()).toEqual({ ip: "203.0.113.5" });
  });
});

describe("security logging", () => {
  it("logs rejected tokens with the reason", async () => {
    await build();
    await app.inject({ method: "GET", url: "/api/auth/me" });
    await app.inject({ method: "GET", url: "/api/auth/me", cookies: { access_token: "forged.token.here" } });

    const rejected = logs.filter((line) => line.securityEvent === "auth.token_rejected");
    expect(rejected.map((line) => line.reason)).toEqual(["missing", "invalid_or_expired"]);
    expect(rejected[0]).toMatchObject({ level: 40, route: "/api/auth/me", ip: expect.any(String) });
  });

  it("redacts secrets from log lines, including headers and nested fields", async () => {
    await build();
    app.get("/leaky", async (request) => {
      request.log.info(
        {
          password: "hunter2",
          req: { headers: { authorization: "Bearer abc.def.ghi", cookie: "session=s3cr3t-cookie" } },
          body: { user: { password: "nested-pw", passwordHash: "$argon2id$..." } },
          deep: { a: { b: { token: "deep-token" } } },
        },
        "oops",
      );
      return "ok";
    });

    await app.inject({ method: "GET", url: "/leaky" });

    const output = JSON.stringify(logs);
    for (const secret of ["hunter2", "abc.def.ghi", "s3cr3t-cookie", "nested-pw", "$argon2id$", "deep-token"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[Redacted]");
  });
});

describe("email fingerprints", () => {
  const fingerprint = createEmailFingerprinter("unit-test-secret-that-is-at-least-32-chars");

  it("are stable and short", () => {
    expect(fingerprint("ana@example.com")).toBe(fingerprint("ana@example.com"));
    expect(fingerprint("ana@example.com")).not.toBe(fingerprint("ben@example.com"));
    expect(fingerprint("ana@example.com")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("can't be confirmed by hashing a guessed email without the server secret", () => {
    const plainHash = createHash("sha256").update("ana@example.com").digest("hex").slice(0, 16);
    const otherServer = createEmailFingerprinter("a-different-secret-that-is-32-chars-long");

    expect(fingerprint("ana@example.com")).not.toBe(plainHash);
    expect(fingerprint("ana@example.com")).not.toBe(otherServer("ana@example.com"));
  });
});
