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

  it("rejects the placeholder secret from .env.example", async () => {
    const { readFile } = await import("node:fs/promises");
    const example = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
    const placeholder = /^JWT_SECRET=(.*)$/m.exec(example)?.[1];

    expect(placeholder).toBeDefined();
    expect(() => loadConfig({ ...required, JWT_SECRET: placeholder })).toThrow(/placeholder/);
  });

  it("rejects an invalid token lifetime", () => {
    expect(() => loadConfig({ ...required, JWT_EXPIRES_IN: "forever" })).toThrow(/JWT_EXPIRES_IN/);
    expect(() => loadConfig({ ...required, JWT_EXPIRES_IN: "0m" })).toThrow(/JWT_EXPIRES_IN/);
  });

  it("caps the token lifetime at 7 days", () => {
    expect(loadConfig({ ...required, JWT_EXPIRES_IN: "7d" }).JWT_EXPIRES_IN).toBe("7d");
    expect(() => loadConfig({ ...required, JWT_EXPIRES_IN: "8d" })).toThrow(/at most 7 days/);
    expect(() => loadConfig({ ...required, JWT_EXPIRES_IN: "9999d" })).toThrow(/at most 7 days/);
  });
});

describe("TRUST_PROXY", () => {
  const trustProxy = (value: string) => loadConfig({ ...required, TRUST_PROXY: value }).TRUST_PROXY;

  it("is off by default", () => {
    expect(loadConfig(required).TRUST_PROXY).toBe(false);
    expect(trustProxy("false")).toBe(false);
  });

  it("accepts proxy addresses, ranges and named ranges", () => {
    expect(trustProxy("10.0.0.0/8, 172.16.0.1")).toBe("10.0.0.0/8, 172.16.0.1");
    expect(trustProxy("loopback")).toBe("loopback");
    expect(trustProxy("::1")).toBe("::1");
  });

  it.each(["true", "1", "*", "anything"])('refuses "%s", which wouldn\'t identify a real proxy', (value) => {
    expect(() => trustProxy(value)).toThrow(/proxy IP addresses/);
  });
});
