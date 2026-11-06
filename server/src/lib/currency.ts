import { z } from "zod";

/**
 * The currencies the app supports: the ones the European Central Bank
 * publishes reference rates for, so a rate can always be looked up. Each maps
 * to its number of decimal places (ISO 4217 minor units): amounts are stored
 * as whole minor units, e.g. ₱150.75 → 15075 and ¥3,000 → 3000.
 */
export const CURRENCIES = {
  AUD: 2,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  CZK: 2,
  DKK: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  HUF: 2,
  IDR: 2,
  ILS: 2,
  INR: 2,
  ISK: 0,
  JPY: 0,
  KRW: 0,
  MXN: 2,
  MYR: 2,
  NOK: 2,
  NZD: 2,
  PHP: 2,
  PLN: 2,
  RON: 2,
  SEK: 2,
  SGD: 2,
  THB: 2,
  TRY: 2,
  USD: 2,
  ZAR: 2,
} as const;

export type Currency = keyof typeof CURRENCIES;

export const DEFAULT_CURRENCY: Currency = "PHP";

export const currency = z.enum(Object.keys(CURRENCIES) as [Currency, ...Currency[]], {
  error: "Choose a supported currency",
});

/** The largest amount the database's 32-bit integer columns can hold. */
export const MAX_AMOUNT = 2_147_483_647;

const RATE = /^(\d{1,10})(?:\.(\d{1,10}))?$/;

/**
 * How much 1 unit of one currency is worth in another, as a decimal string
 * ("0.39756"). Kept as text, never a float, so conversions are exact.
 */
export const exchangeRate = z
  .string()
  .trim()
  .regex(RATE, "Use a number like 0.3975, with at most 10 decimal places")
  .refine((value) => /[1-9]/.test(value), "The rate must be more than 0");

export class ConversionError extends Error {
  override name = "ConversionError";
}

/**
 * Converts `amount` (minor units of `from`) to minor units of `to` at `rate`,
 * rounding half up. BigInt keeps it exact: ¥3,000 at 0.39756 is exactly
 * ₱1,192.68.
 */
export function convert(amount: number, from: Currency, to: Currency, rate: string): number {
  const match = RATE.exec(rate);
  if (!match) throw new ConversionError(`Not a valid exchange rate: ${rate}`);
  const fraction = match[2] ?? "";
  const scaledRate = BigInt(match[1]! + fraction);

  // amount × rate × 10^(to decimals) / 10^(from decimals)
  const numerator = BigInt(amount) * scaledRate * 10n ** BigInt(CURRENCIES[to]);
  const denominator = 10n ** BigInt(fraction.length + CURRENCIES[from]);
  const converted = (numerator * 2n + denominator) / (denominator * 2n);

  if (converted <= 0n) {
    throw new ConversionError(`That's less than the smallest amount in ${to} after converting`);
  }
  if (converted > BigInt(MAX_AMOUNT)) {
    throw new ConversionError(`That's too large an amount in ${to} after converting`);
  }
  return Number(converted);
}
