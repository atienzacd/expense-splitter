import { describe, expect, it } from "vitest";
import {
  convertMoney,
  CURRENCY_OPTIONS,
  currencySymbol,
  formatMoney,
  formatPesos,
  MAX_CENTAVOS,
  parseMoney,
  parsePesos,
  parseRate,
  splitEvenly,
} from "./money.ts";

describe("parsePesos", () => {
  it.each([
    ["150.75", 15_075],
    ["150", 15_000],
    ["150.5", 15_050],
    ["0.01", 1],
    ["1,500.00", 150_000],
    ["₱20", 2_000],
    ["  42.10 ", 4_210],
  ])("reads %s as %i centavos", (input, centavos) => {
    expect(parsePesos(input)).toBe(centavos);
  });

  it("avoids floating-point mistakes", () => {
    // 0.1 + 0.2 style errors would turn 1.15 into 114.99999 centavos.
    expect(parsePesos("1.15")).toBe(115);
    expect(parsePesos("19.99")).toBe(1_999);
  });

  it.each(["", "abc", "0", "0.00", "-5", "1.234", "1.2.3", "1e5", "12 34"])("rejects %j", (input) => {
    expect(parsePesos(input)).toBeNull();
  });

  it("rejects amounts the database can't store", () => {
    expect(parsePesos("21474836.47")).toBe(MAX_CENTAVOS);
    expect(parsePesos("21474836.48")).toBeNull();
  });
});

describe("formatPesos", () => {
  it("shows centavos as pesos with the peso sign", () => {
    expect(formatPesos(15_075)).toBe("₱150.75");
    expect(formatPesos(150_000)).toBe("₱1,500.00");
    expect(formatPesos(1)).toBe("₱0.01");
  });
});

describe("splitEvenly", () => {
  it("matches the server: leftover centavos go to the first people", () => {
    expect(splitEvenly(10_000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEvenly(2, 3)).toEqual([1, 1, 0]);
    expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
  });

  it("returns nothing for nobody", () => {
    expect(splitEvenly(100, 0)).toEqual([]);
  });
});

describe("other currencies", () => {
  it("formats each with its own decimals", () => {
    expect(formatMoney(3000, "JPY")).toBe("¥3,000");
    expect(formatMoney(1234, "USD")).toBe("$12.34");
    expect(formatMoney(150_000, "KRW")).toBe("₩150,000");
  });

  it("reads amounts with the right number of decimals", () => {
    expect(parseMoney("3,000", "JPY")).toBe(3000);
    expect(parseMoney("¥3000", "JPY")).toBe(3000);
    expect(parseMoney("3000.5", "JPY")).toBeNull();
    expect(parseMoney("US$12.34", "USD")).toBe(1234);
    expect(parseMoney("-5", "USD")).toBeNull();
  });

  it("converts exactly like the server", () => {
    expect(convertMoney(3000, "JPY", "PHP", "0.39756")).toBe(119_268);
    expect(convertMoney(1234, "USD", "PHP", "58.1")).toBe(71_695);
    expect(convertMoney(1, "JPY", "PHP", "0.001")).toBeNull();
  });

  it("accepts rates as plain decimals only", () => {
    expect(parseRate(" 0.3976 ")).toBe("0.3976");
    for (const bad of ["", "0", "0.00", "-1", "1e3", "abc", ".5"]) expect(parseRate(bad)).toBeNull();
  });

  it("knows the symbols people expect", () => {
    expect(currencySymbol("PHP")).toBe("₱");
    expect(currencySymbol("JPY")).toBe("¥");
  });

  it("lists pesos first", () => {
    expect(CURRENCY_OPTIONS[0]).toEqual({ code: "PHP", label: "PHP — Philippine Peso" });
    expect(CURRENCY_OPTIONS.map((o) => o.code)).toContain("JPY");
  });
});
