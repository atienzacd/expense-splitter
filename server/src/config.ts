import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // 127.0.0.1 keeps the dev server off your network; Docker sets 0.0.0.0.
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
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
