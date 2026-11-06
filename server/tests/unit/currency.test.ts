import { describe, expect, it, vi } from "vitest";
import { ConversionError, convert, currency, exchangeRate } from "../../src/lib/currency.ts";
import { createFrankfurterSource, RatesUnavailableError, rateToString } from "../../src/modules/rates/source.ts";

describe("convert", () => {
  it("converts exactly between currencies with different decimal places", () => {
    // ¥3,000 at 1 JPY = 0.39756 PHP is ₱1,192.68.
    expect(convert(3000, "JPY", "PHP", "0.39756")).toBe(119_268);
    // ₱1,192.68 at 1 PHP = 2.5153 JPY is ¥3,000 (2999.9...).
    expect(convert(119_268, "PHP", "JPY", "2.5153")).toBe(3000);
    // $12.34 at 1 USD = 58.1 PHP is ₱716.954, rounded to ₱716.95.
    expect(convert(1234, "USD", "PHP", "58.1")).toBe(71_695);
  });

  it("rounds half up", () => {
    expect(convert(1, "USD", "PHP", "0.5")).toBe(1); // 0.5 centavo
    expect(convert(3, "USD", "PHP", "0.49")).toBe(1); // 1.47 centavos
    expect(convert(3, "USD", "PHP", "0.5")).toBe(2); // 1.5 centavos
  });

  it("refuses amounts that would round to nothing or overflow", () => {
    expect(() => convert(1, "KRW", "USD", "0.0007")).toThrow(ConversionError);
    expect(() => convert(2_000_000_000, "USD", "IDR", "16000")).toThrow(ConversionError);
  });
});

describe("validation", () => {
  it("accepts only supported currency codes", () => {
    expect(currency.parse("JPY")).toBe("JPY");
    expect(currency.safeParse("jpy").success).toBe(false);
    expect(currency.safeParse("XYZ").success).toBe(false);
  });

  it("accepts rates as plain decimal text only", () => {
    expect(exchangeRate.parse(" 0.39756 ")).toBe("0.39756");
    for (const bad of ["0", "0.000", "-1", "1e-5", "abc", "1.12345678901", "", ".5"]) {
      expect(exchangeRate.safeParse(bad).success).toBe(false);
    }
  });
});

describe("rateToString", () => {
  it("writes rates as plain decimals, never in exponent form", () => {
    expect(rateToString(0.39756)).toBe("0.39756");
    expect(rateToString(58)).toBe("58");
    expect(rateToString(0.0000534)).toBe("0.0000534");
    expect(() => rateToString(1e-12)).toThrow(RatesUnavailableError);
  });
});

describe("Frankfurter rate source", () => {
  const answer = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));

  it("asks for just the two currencies and caches the answer", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => answer({ amount: 1, base: "JPY", date: "2026-11-05", rates: { PHP: 0.39756 } }));
    const rates = createFrankfurterSource({ baseUrl: "https://rates.test/v1", fetch: fetchMock });

    expect(await rates("JPY", "PHP")).toEqual({ rate: "0.39756", date: "2026-11-05" });
    await rates("JPY", "PHP");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL("https://rates.test/v1/latest?base=JPY&symbols=PHP"));
  });

  it("needs no lookup for the same currency", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const rates = createFrankfurterSource({ fetch: fetchMock });
    expect((await rates("PHP", "PHP")).rate).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails clearly, and tries again next time, when the service is down or odd", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockReturnValueOnce(answer({ message: "oops" }, 500))
      .mockReturnValueOnce(answer({ date: "2026-11-05", rates: {} }))
      .mockReturnValueOnce(answer({ date: "2026-11-05", rates: { PHP: 0.4 } }));
    const rates = createFrankfurterSource({ fetch: fetchMock });

    await expect(rates("JPY", "PHP")).rejects.toThrow(RatesUnavailableError);
    await expect(rates("JPY", "PHP")).rejects.toThrow(RatesUnavailableError);
    await expect(rates("JPY", "PHP")).rejects.toThrow(RatesUnavailableError);
    expect((await rates("JPY", "PHP")).rate).toBe("0.4");
  });
});
