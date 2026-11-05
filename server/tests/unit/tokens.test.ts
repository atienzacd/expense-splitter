import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createTokenSigner } from "../../src/modules/auth/tokens.ts";

const SECRET = "unit-test-secret-that-is-at-least-32-chars";
const USER_ID = "0196f3a0-0000-7000-8000-000000000001";
const CLAIMS = { userId: USER_ID, sessionId: "0196f3a0-0000-7000-8000-0000000000aa" };

describe("tokens", () => {
  it("round-trips the user and session ids", async () => {
    const tokens = createTokenSigner(SECRET, "1h");
    expect(await tokens.verify(await tokens.sign(CLAIMS))).toEqual(CLAIMS);
  });

  it("rejects a token signed with another secret", async () => {
    const theirs = createTokenSigner("someone-elses-secret-that-is-32-chars!", "1h");
    const ours = createTokenSigner(SECRET, "1h");
    expect(await ours.verify(await theirs.sign(CLAIMS))).toBeNull();
  });

  it("rejects an expired token", async () => {
    const key = new TextEncoder().encode(SECRET);
    const expired = await new SignJWT()
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer("expense-splitter")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect(await createTokenSigner(SECRET, "1h").verify(expired)).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const tokens = createTokenSigner(SECRET, "1h");
    const [header, , signature] = (await tokens.sign(CLAIMS)).split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "someone-else", iss: "expense-splitter" })).toString(
      "base64url",
    );
    expect(await tokens.verify(`${header}.${forgedPayload}.${signature}`)).toBeNull();
  });

  it("rejects an unsigned token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: USER_ID, iss: "expense-splitter" })).toString("base64url");
    expect(await createTokenSigner(SECRET, "1h").verify(`${header}.${payload}.`)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await createTokenSigner(SECRET, "1h").verify("not-a-token")).toBeNull();
  });
});

describe("tokens without a session id", () => {
  it("are rejected, so every access token can be tied to a live session", async () => {
    const key = new TextEncoder().encode(SECRET);
    const noSession = await new SignJWT()
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer("expense-splitter")
      .setExpirationTime("1h")
      .sign(key);
    expect(await createTokenSigner(SECRET, "1h").verify(noSession)).toBeNull();
  });
});
