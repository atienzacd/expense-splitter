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

  it("rejects an invalid token lifetime with a single clear message", () => {
    expect(() => loadConfig({ ...required, JWT_EXPIRES_IN: "0m" })).toThrow(/JWT_EXPIRES_IN/);

    const error = (() => {
      try {
        loadConfig({ ...required, JWT_EXPIRES_IN: "forever" });
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(error).toMatch(/Use a duration like/);
    expect(error).not.toMatch(/at most 7 days/);
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

  it.each(["true", "1", "*", "anything", "999.1.1.1", ":", "10.0.0.1/33", "10.0.0.0/8/8", "10.0.0.1, nope"])(
    'refuses "%s", which isn\'t a real proxy address',
    (value) => {
      expect(() => trustProxy(value)).toThrow(/Not a valid proxy address/);
    },
  );

  it.each(["0.0.0.0/0", "::/0", "0.0.0.0/1", "10.0.0.0/7", "2001::/15"])(
    'refuses "%s", a range so wide it would trust ordinary clients',
    (value) => {
      expect(() => trustProxy(value)).toThrow(/Ranges wider than/);
    },
  );

  it("accepts the widest allowed ranges", () => {
    expect(trustProxy("10.0.0.0/8")).toBe("10.0.0.0/8");
    expect(trustProxy("fd00::/16")).toBe("fd00::/16");
  });
});
