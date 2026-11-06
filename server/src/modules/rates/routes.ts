import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../errors.ts";
import { currency } from "../../lib/currency.ts";
import type { ExchangeRateSource } from "./source.ts";

export type RateRoutesOptions = { exchangeRates: ExchangeRateSource };

const rateQuery = z.object({ from: currency, to: currency });

export async function rateRoutes(app: FastifyInstance, { exchangeRates }: RateRoutesOptions): Promise<void> {
  // A suggestion for the add-expense form; people can still type their own rate.
  app.get("/", async (request) => {
    const { from, to } = rateQuery.parse(request.query);
    try {
      return { from, to, ...(await exchangeRates(from, to)) };
    } catch (error) {
      request.log.warn({ err: error, from, to }, "exchange rate lookup failed");
      throw new HttpError(503, "RatesUnavailable", "Couldn't get the exchange rate right now. You can type it in.");
    }
  });
}
