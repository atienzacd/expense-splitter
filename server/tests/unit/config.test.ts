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
      ACCESS_TOKEN_TTL: "15m",
      REFRESH_TOKEN_TTL: "14d",
      ALLOWED_ORIGINS: ["http://localhost:5173", "http://127.0.0.1:5173"],
      COOKIE_SECURE: true,
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
    expect(() => loadConfig({ ...required, ACCESS_TOKEN_TTL: "0m" })).toThrow(/ACCESS_TOKEN_TTL/);

    const error = (() => {
      try {
        loadConfig({ ...required, ACCESS_TOKEN_TTL: "forever" });
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(error).toMatch(/Use a duration like/);
    expect(error).not.toMatch(/at most/);
  });

  it("keeps access tokens short-lived: at most 1 hour", () => {
    expect(loadConfig({ ...required, ACCESS_TOKEN_TTL: "1h" }).ACCESS_TOKEN_TTL).toBe("1h");
    expect(() => loadConfig({ ...required, ACCESS_TOKEN_TTL: "61m" })).toThrow(/at most 1 hour/);
    expect(() => loadConfig({ ...required, ACCESS_TOKEN_TTL: "1d" })).toThrow(/at most 1 hour/);
  });

  it("caps login sessions at 90 days", () => {
    expect(loadConfig({ ...required, REFRESH_TOKEN_TTL: "90d" }).REFRESH_TOKEN_TTL).toBe("90d");
    expect(() => loadConfig({ ...required, REFRESH_TOKEN_TTL: "91d" })).toThrow(/at most 90 days/);
  });

  it("reads allowed origins and refuses anything that isn't an origin", () => {
    expect(loadConfig({ ...required, ALLOWED_ORIGINS: "https://a.example, https://b.example:8443" }).ALLOWED_ORIGINS).toEqual([
      "https://a.example",
      "https://b.example:8443",
    ]);
    for (const bad of ["https://a.example/path", "a.example", "*", "ftp://a.example", ""]) {
      expect(() => loadConfig({ ...required, ALLOWED_ORIGINS: bad })).toThrow(/Not a valid origin/);
    }
  });

  it("lets secure cookies be turned off for local development only by choice", () => {
    expect(loadConfig({ ...required, COOKIE_SECURE: "false" }).COOKIE_SECURE).toBe(false);
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
