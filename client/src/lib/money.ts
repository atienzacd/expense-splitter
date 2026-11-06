/**
 * Money is whole minor units everywhere in the app (₱150.75 → 15075,
 * ¥3,000 → 3000), exactly like the server. Decimal amounts only exist at the
 * edges: what people type and see.
 */

/**
 * The currencies the server supports (the ones the European Central Bank
 * publishes rates for) and their decimal places (ISO 4217). Keep in step with
 * server/src/lib/currency.ts.
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

/** The largest amount the server's 32-bit column can hold. */
export const MAX_CENTAVOS = 2_147_483_647;

const names = new Intl.DisplayNames("en", { type: "currency" });

/** "JPY — Japanese Yen", for pickers. PHP first, then alphabetical. */
export const CURRENCY_OPTIONS = (Object.keys(CURRENCIES) as Currency[])
  .sort((a, b) => (a === DEFAULT_CURRENCY ? -1 : b === DEFAULT_CURRENCY ? 1 : a.localeCompare(b)))
  .map((code) => ({ code, label: `${code} — ${names.of(code) ?? code}` }));

export function isCurrency(code: string): code is Currency {
  return Object.hasOwn(CURRENCIES, code);
}

const formatters = new Map<string, Intl.NumberFormat>();

/** 15075 PHP → "₱150.75"; 3000 JPY → "¥3,000". */
export function formatMoney(amount: number, currency: string): string {
  const decimals = isCurrency(currency) ? CURRENCIES[currency] : 2;
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(currency, formatter);
  }
  return formatter.format(amount / 10 ** decimals);
}

/**
 * Reads an amount typed by a person ("150.75", "1,500", "₱20.5", "¥3000")
 * into minor units of `currency`, without floating-point rounding. Returns
 * null when it isn't a positive amount with at most that currency's decimals.
 */
export function parseMoney(input: string, currency: Currency): number | null {
  const decimals = CURRENCIES[currency];
  // Drop a leading currency sign or code (₱, ¥, $, US$, JPY ...) and thousands separators.
  const cleaned = input.trim().replace(/^[\p{Sc}\p{L}\s]+/u, "").replaceAll(",", "").trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;

  const minor = Number(match[1]) * 10 ** decimals + Number(fraction.padEnd(decimals, "0") || "0");
  return minor > 0 && minor <= MAX_CENTAVOS ? minor : null;
}

/** "₱" for PHP, "¥" for JPY; the code itself ("THB") when there's no common sign. */
export function currencySymbol(currency: string): string {
  return (
    new Intl.NumberFormat("en-PH", { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency
  );
}

/** 15075 → "₱150.75" */
export const formatPesos = (centavos: number) => formatMoney(centavos, "PHP");

/** "150.75" → 15075 centavos, or null. */
export const parsePesos = (input: string) => parseMoney(input, "PHP");

const RATE = /^(\d{1,10})(?:\.(\d{1,10}))?$/;

/** A rate as typed ("0.3976"), or null if it isn't a positive decimal the server accepts. */
export function parseRate(input: string): string | null {
  const value = input.trim();
  return RATE.test(value) && /[1-9]/.test(value) ? value : null;
}

/**
 * Same conversion as the server, exactly: `amount` of `from` at `rate`, in
 * minor units of `to`, rounded half up. Null if it rounds to nothing or is
 * too large to store.
 */
export function convertMoney(amount: number, from: Currency, to: Currency, rate: string): number | null {
  const match = RATE.exec(rate);
  if (!match) return null;
  const fraction = match[2] ?? "";
  const numerator = BigInt(amount) * BigInt(match[1]! + fraction) * 10n ** BigInt(CURRENCIES[to]);
  const denominator = 10n ** BigInt(fraction.length + CURRENCIES[from]);
  const converted = (numerator * 2n + denominator) / (denominator * 2n);
  return converted > 0n && converted <= BigInt(MAX_CENTAVOS) ? Number(converted) : null;
}

/** Same rule as the server: everyone gets an equal share and the first people listed absorb the leftover centavos. */
export function splitEvenly(total: number, people: number): number[] {
  if (people <= 0) return [];
  const base = Math.floor(total / people);
  const leftover = total % people;
  return Array.from({ length: people }, (_, i) => base + (i < leftover ? 1 : 0));
}
