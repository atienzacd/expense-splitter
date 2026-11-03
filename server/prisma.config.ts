import { defineConfig, env } from "prisma/config";

// Load server/.env for local development. In CI and Docker the variables are
// set directly, so a missing file is fine.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
