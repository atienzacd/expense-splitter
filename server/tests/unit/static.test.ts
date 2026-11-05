import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import type { PrismaClient } from "../../src/db.ts";

let app: FastifyInstance;
let root: string;
let site: string;

// A tiny stand-in for the built web app, next to a file that must stay private.
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "expense-splitter-static-"));
  site = join(root, "public");
  await mkdir(join(site, "assets"), { recursive: true });
  await writeFile(join(site, "index.html"), "<!doctype html><title>Expense Splitter</title>");
  await writeFile(join(site, "theme.js"), "/* theme */");
  await writeFile(join(site, "assets", "index-abc123.js"), "console.log('app')");
  await writeFile(join(root, "secret.env"), "JWT_SECRET=do-not-serve-me");

  app = await buildApp({
    prisma: {} as PrismaClient,
    jwtSecret: "unit-test-secret-that-is-at-least-32-chars",
    checkDatabase: async () => {},
    staticDir: site,
  });
});

afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ method: "GET", url });

describe("hosting the web app", () => {
  it("serves the app at / without caching the page itself", async () => {
    const response = await get("/");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.body).toContain("<title>Expense Splitter</title>");
  });

  it("caches hashed build files for a year, and other files not at all", async () => {
    const asset = await get("/assets/index-abc123.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    expect((await get("/theme.js")).headers["cache-control"]).toBe("no-cache");
  });

  it("answers app pages like /groups/123 with the app, so its router can take over", async () => {
    const response = await get("/groups/0196f3a0-0000-7000-8000-0000000000a1");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Expense Splitter</title>");
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("keeps JSON 404s for unknown API paths", async () => {
    const response = await get("/api/nope");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "NotFound", message: "Not found" });
  });

  it.each(["/../secret.env", "/%2e%2e/secret.env", "/assets/../../secret.env", "/..%2fsecret.env"])(
    "never serves files outside the app folder (%s)",
    async (url) => {
      const response = await get(url);
      expect(response.body).not.toContain("do-not-serve-me");
    },
  );

  it("still sends the security headers with the app", async () => {
    const response = await get("/");
    expect(response.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
