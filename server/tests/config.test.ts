import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      HOST: "127.0.0.1",
      PORT: 3000,
      LOG_LEVEL: "info",
    });
  });

  it("reads PORT from a string", () => {
    expect(loadConfig({ DATABASE_URL, PORT: "8080" }).PORT).toBe(8080);
  });

  it("fails fast when required settings are missing or invalid", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL, PORT: "not-a-port" })).toThrow(/PORT/);
  });
});
