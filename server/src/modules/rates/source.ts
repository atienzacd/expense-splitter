import { z } from "zod";
import type { Currency } from "../../lib/currency.ts";

export type RateQuote = {
  /** How much 1 unit of `from` is worth in `to`, as a decimal string. */
  rate: string;
  /** The day the rate was published, YYYY-MM-DD. */
  date: string;
};

/** Looks up today's rate between two currencies. Rejects if it can't. */
export type ExchangeRateSource = (from: Currency, to: Currency) => Promise<RateQuote>;

export class RatesUnavailableError extends Error {
  override name = "RatesUnavailableError";
}

export const DEFAULT_EXCHANGE_RATES_URL = "https://api.frankfurter.dev/v1";

const frankfurterResponse = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.record(z.string(), z.number().positive()),
});

type FrankfurterOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Rates are published once a working day, so an hour-old one is still current. */
  cacheMs?: number;
  timeoutMs?: number;
};

/** A float rate as an exact decimal string with at most 10 decimals ("0.39756"). */
export function rateToString(rate: number): string {
  const text = rate.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  if (!/[1-9]/.test(text)) throw new RatesUnavailableError("The rate is too small to use");
  return text;
}

/**
 * Rates from Frankfurter (https://frankfurter.dev), a free service that
 * republishes the European Central Bank's daily reference rates. Only the two
 * currency codes are sent, never anything about the user or the expense.
 */
export function createFrankfurterSource(options: FrankfurterOptions = {}): ExchangeRateSource {
  const baseUrl = options.baseUrl ?? DEFAULT_EXCHANGE_RATES_URL;
  const fetchFn = options.fetch ?? fetch;
  const cacheMs = options.cacheMs ?? 60 * 60 * 1000;
  const timeoutMs = options.timeoutMs ?? 5000;
  const cache = new Map<string, { at: number; quote: Promise<RateQuote> }>();

  async function lookUp(from: Currency, to: Currency): Promise<RateQuote> {
    const url = new URL(`${baseUrl}/latest`);
    url.searchParams.set("base", from);
    url.searchParams.set("symbols", to);
    let response: Response;
    try {
      response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    } catch (error) {
      throw new RatesUnavailableError(`Exchange rate service unreachable: ${String(error)}`);
    }
    if (!response.ok) throw new RatesUnavailableError(`Exchange rate service answered ${response.status}`);

    const parsed = frankfurterResponse.safeParse(await response.json().catch(() => undefined));
    const rate = parsed.success ? parsed.data.rates[to] : undefined;
    if (!parsed.success || rate === undefined) {
      throw new RatesUnavailableError("Exchange rate service sent an unexpected answer");
    }
    return { rate: rateToString(rate), date: parsed.data.date };
  }

  return (from, to) => {
    if (from === to) return Promise.resolve({ rate: "1", date: new Date().toISOString().slice(0, 10) });

    const key = `${from}-${to}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < cacheMs) return hit.quote;

    const quote = lookUp(from, to);
    cache.set(key, { at: now, quote });
    // Failures aren't kept, so the next request tries again.
    quote.catch(() => cache.delete(key));
    return quote;
  };
}
