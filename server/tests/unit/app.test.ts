import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";
import type { PrismaClient } from "../../src/db.ts";
import { simplifyDebts } from "../../src/lib/settle.ts";
import { splitEqually } from "../../src/lib/split.ts";

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

const databaseUp = async () => {};
const databaseDown = async () => {
  throw new Error("connection refused");
};

// These tests never reach the database, so a stand-in client is enough.
const withDatabase = (checkDatabase: () => Promise<void>) => ({
  prisma: {} as PrismaClient,
  jwtSecret: "unit-test-secret-that-is-at-least-32-chars",
  checkDatabase,
});

describe("GET /health", () => {
  it("reports ok when the database is reachable", async () => {
    app = await buildApp(withDatabase(databaseUp));
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    app = await buildApp(withDatabase(databaseDown));
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "error", database: "unreachable" });
  });

  it("sends security headers", async () => {
    app = await buildApp(withDatabase(databaseUp));
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBeDefined();
  });
});

describe("error handling", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    app = await buildApp(withDatabase(databaseUp));
    const response = await app.inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "NotFound", message: "Not found" });
  });

  it("turns validation errors into a 400 with details", async () => {
    app = await buildApp(withDatabase(databaseUp));
    app.post("/validate", async (request) => {
      z.object({ name: z.string() }).parse(request.body);
      return { ok: true };
    });

    const response = await app.inject({ method: "POST", url: "/validate", payload: { name: 42 } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "ValidationError",
      issues: [{ path: "name" }],
    });
  });

  it("turns split errors into a 400", async () => {
    app = await buildApp(withDatabase(databaseUp));
    app.get("/bad-split", async () => splitEqually(-1, ["a"]));

    const response = await app.inject({ method: "GET", url: "/bad-split" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "SplitError" });
  });

  it("treats stored data that doesn't add up as a server error, not the client's", async () => {
    app = await buildApp(withDatabase(databaseUp));
    app.get("/bad-balances", async () => simplifyDebts(new Map([["a", 100]])));

    const response = await app.inject({ method: "GET", url: "/bad-balances" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "InternalServerError", message: "Something went wrong" });
  });

  it("returns 400 for malformed JSON", async () => {
    app = await buildApp(withDatabase(databaseUp));
    // Returns a fixed response: test routes never reflect input back (CodeQL js/reflected-xss).
    app.post("/upload", async () => ({ ok: true }));

    const response = await app.inject({
      method: "POST",
      url: "/upload",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "BadRequest" });
  });

  it("hides the details of unexpected errors", async () => {
    app = await buildApp(withDatabase(databaseUp));
    app.get("/crash", async () => {
      throw new Error("secret internal detail");
    });

    const response = await app.inject({ method: "GET", url: "/crash" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "InternalServerError", message: "Something went wrong" });
  });
});
