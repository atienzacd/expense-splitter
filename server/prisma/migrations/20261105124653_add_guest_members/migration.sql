-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_guest" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "password_hash" DROP NOT NULL;

-- A person is either an account (email and password, not a guest) or a guest
-- (neither), never a mix: a guest can never have credentials to log in with.
ALTER TABLE "users" ADD CONSTRAINT "users_account_or_guest" CHECK (
  ("is_guest" AND "email" IS NULL AND "password_hash" IS NULL)
  OR (NOT "is_guest" AND "email" IS NOT NULL AND "password_hash" IS NOT NULL)
);
