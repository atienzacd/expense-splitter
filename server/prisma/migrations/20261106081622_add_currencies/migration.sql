-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "exchange_rate" DECIMAL(20,10),
ADD COLUMN     "original_amount" INTEGER,
ADD COLUMN     "original_currency" CHAR(3);

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'PHP';

-- Existing groups keep using pesos (the default above).

-- Backstops for the API's own checks: a currency is three capital letters, and
-- a foreign-currency expense has all three original fields, each sensible, and
-- in a different currency from the group's (checked by the API).
ALTER TABLE "groups" ADD CONSTRAINT "groups_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_original_complete" CHECK (
  ("original_currency" IS NULL AND "original_amount" IS NULL AND "exchange_rate" IS NULL)
  -- IS NOT NULL is spelled out: a comparison with NULL is "unknown", which a CHECK lets through.
  OR ("original_currency" IS NOT NULL AND "original_amount" IS NOT NULL AND "exchange_rate" IS NOT NULL
      AND "original_currency" ~ '^[A-Z]{3}$' AND "original_amount" > 0 AND "exchange_rate" > 0)
);
