import { z } from "zod";

/** Money in whole centavos (₱150.75 → 15075), within the database's 32-bit integer column. */
export const centavos = z.number().int().positive().max(2_147_483_647);

/** Emails are trimmed and lowercased, so comparisons ignore case and stray spaces. */
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** The user fields safe to return to other users. Never includes passwordHash. */
export const publicUserSelect = { id: true, name: true, email: true } as const;
