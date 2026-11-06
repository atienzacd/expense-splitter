import type { Currency } from "../lib/money.ts";
import { api } from "./client.ts";

export type RateQuote = { from: Currency; to: Currency; rate: string; date: string };

/** Today's European Central Bank rate: 1 `from` = `rate` `to`. */
export const getRate = (from: Currency, to: Currency) =>
  api<RateQuote>(`/rates?${new URLSearchParams({ from, to }).toString()}`);
