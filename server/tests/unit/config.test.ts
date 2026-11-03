import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";

const required = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  JWT_SECRET: "a-test-secret-that-is-at-least-32-characters",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig(required)).toEqual({
      ...required,
      HOST: "127.0.0.1",
      PORT: 3000,
      TRUST_PROXY: false,
      LOG_LEVEL: "info",
      JWT_EXPIRES_IN: "1d",
    });
  });

  it("reads PORT from a string", () => {
    expect(loadConfig({ ...required, PORT: "8080" }).PORT).toBe(8080);
  });

  it("fails fast when required settings are missing or invalid", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...required, PORT: "not-a-port" })).toThrow(/PORT/);
  });

  it("rejects a short JWT secret", () => {
    expect(() => loadConfig({ ...required, JWT_SECRET: "too-short" })).toThrow(/at least 32 characters/);
  });

  it("rejects an invalid token lifetime", () => {
    expect(() => loadConfig({ ...required, JWT_EXPIRES_IN: "forever" })).toThrow(/JWT_EXPIRES_IN/);
  });
});
