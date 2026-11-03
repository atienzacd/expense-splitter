import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { TEST_DATABASE_URL } from "./helpers.ts";

/**
 * Runs once before the integration tests: creates the test database if it is
 * missing and applies every migration, exactly as production would.
 */
export default function setup(): void {
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
