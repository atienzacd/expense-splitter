-- Database-level backstops for rules the API already enforces, so a bug or a
-- manual query can't store money that doesn't make sense.

-- Expenses and settlements move a positive number of centavos.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_amount_positive" CHECK ("amount" > 0);

-- Everyone in a split owes something (zero shares aren't stored).
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_amount_owed_positive" CHECK ("amount_owed" > 0);

-- Nobody pays themselves.
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_different_people" CHECK ("from_user_id" <> "to_user_id");
