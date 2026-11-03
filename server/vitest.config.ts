import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Fast, no database: runs on every OS in CI.
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        // Real PostgreSQL test database: run with `npm run test:integration`.
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // Test files share one database, so they run one at a time.
          fileParallelism: false,
          testTimeout: 15_000,
        },
      },
    ],
  },
});
