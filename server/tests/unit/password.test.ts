import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/modules/auth/password.ts";

describe("password hashing", () => {
  it("produces an argon2id hash in PHC format", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[\w-]+\$[\w-]+$/);
    expect(hash).not.toContain("correct horse");
  });

  it("uses a different salt every time", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toBe(b);
  });

  it("accepts the right password and rejects others", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
    expect(await verifyPassword("s3cret-Pass", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("rejects malformed or tampered hashes without throwing", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", "not a hash")).toBe(false);
    expect(await verifyPassword("s3cret-pass", hash.replace("v=19", "v=16"))).toBe(false);
    expect(await verifyPassword("s3cret-pass", hash.replace("m=19456", "m=1"))).toBe(false);
    expect(await verifyPassword("s3cret-pass", hash.slice(0, -4) + "AAAA")).toBe(false);
  });
});
