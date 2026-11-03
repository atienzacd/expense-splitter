import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // 127.0.0.1 keeps the dev server off your network; Docker sets 0.0.0.0.
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  // Only enable behind a reverse proxy you control, or clients can fake their IP.
  TRUST_PROXY: z.stringbool().default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Signs login tokens. Anyone with this value can log in as any user.
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  // How long a login lasts, e.g. "15m", "12h", "7d".
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/, 'Use a duration like "15m", "12h" or "7d"').default("1d"),
});

export type Config = z.infer<typeof envSchema>;

/** Reads settings from environment variables and fails fast if any are invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
