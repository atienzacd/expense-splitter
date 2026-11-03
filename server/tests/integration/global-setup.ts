import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { TEST_DATABASE_URL } from "./helpers.ts";

/**
 * Runs once before the integration tests: creates the test database if it is
 * missing and applies every migration, exactly as production would.
 */
export default function setup(): void {
  // The tests empty every table between runs. Refuse anything that isn't
  // clearly a throwaway test database, so a wrong URL can't wipe real data.
  const databaseName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against "${databaseName}": ` +
        'the test database name must end in "_test" because the tests delete all of its data.',
    );
  }

  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
