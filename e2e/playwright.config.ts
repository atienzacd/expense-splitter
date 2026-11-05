import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: a real Chromium drives the real app (Vite dev server)
 * talking to the real API and a real PostgreSQL database. Both servers run on
 * their own ports so they don't clash with ones you already have open.
 */

const API_PORT = 3100;
const WEB_PORT = 5174;
const WEB_URL = `http://localhost:${WEB_PORT}`;

/**
 * A separate database, so the tests never touch your development data. Tests
 * sign up people with unique emails, so rows left from earlier runs don't matter.
 */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://splitter:splitter@localhost:5432/splitter_e2e";

const databaseName = new URL(E2E_DATABASE_URL).pathname.slice(1);
if (!databaseName.endsWith("_e2e")) {
  throw new Error(`Refusing to run end-to-end tests against "${databaseName}": the name must end in "_e2e".`);
}

export default defineConfig({
  testDir: "./tests",
  // The tests share one database and some walk through multi-step stories.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Creates and migrates the e2e database (Playwright starts web servers
      // before anything else), then runs the TypeScript source directly with
      // settings only from `env` below, so it behaves the same locally and in CI.
      command: "npx prisma migrate deploy && node src/index.ts",
      cwd: "../server",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        HOST: "127.0.0.1",
        PORT: String(API_PORT),
        LOG_LEVEL: "warn",
        JWT_SECRET: "e2e-only-secret-that-is-at-least-32-characters-long",
        ALLOWED_ORIGINS: WEB_URL,
      },
    },
    {
      command: `npm run dev -w client -- --port ${WEB_PORT} --strictPort`,
      cwd: "..",
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
