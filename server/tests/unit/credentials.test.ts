import { describe, expect, it } from "vitest";
import { checkCredentials, hashPassword } from "../../src/modules/auth/password.ts";

async function timeMs(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function median(fn: () => Promise<unknown>, runs = 5): Promise<number> {
  const times = [];
  for (let i = 0; i < runs; i++) times.push(await timeMs(fn));
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
}

describe("checkCredentials", () => {
  it("accepts only the right password for an existing account", async () => {
    const hash = await hashPassword("right-password");
    expect(await checkCredentials("right-password", hash)).toBe(true);
    expect(await checkCredentials("wrong-password", hash)).toBe(false);
  });

  it("always rejects when there is no account", async () => {
    expect(await checkCredentials("anything", undefined)).toBe(false);
  });

  it("takes about as long for an unknown account as for a wrong password", async () => {
    // Skipping the hash for unknown accounts would make them answer in well
    // under a millisecond, revealing which emails are registered.
    const hash = await hashPassword("right-password");
    const wrongPassword = await median(() => checkCredentials("wrong-password", hash));
    const unknownAccount = await median(() => checkCredentials("wrong-password", undefined));

    expect(unknownAccount).toBeGreaterThan(wrongPassword * 0.5);
  });
});
