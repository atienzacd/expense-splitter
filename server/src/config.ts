import { z } from "zod";

const DURATION_SECONDS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;
const MAX_TOKEN_LIFETIME_SECONDS = 7 * 86_400;

function durationSeconds(value: string): number {
  const unit = value.at(-1) as keyof typeof DURATION_SECONDS;
  return Number(value.slice(0, -1)) * DURATION_SECONDS[unit];
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // 127.0.0.1 keeps the dev server off your network; Docker sets 0.0.0.0.
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  // The IP addresses or CIDR ranges of reverse proxies in front of the app (or
  // "loopback" / "uniquelocal" for a proxy on the same machine / private network).
  // Only requests arriving from these addresses may set the client IP through
  // X-Forwarded-For. Never "true", which would let any client pick its own IP and
  // dodge rate limits. (A plain proxy count isn't offered: it can't tell a real
  // proxy from a client pretending to be one.)
  TRUST_PROXY: z
    .string()
    .trim()
    .default("false")
    .transform((value, ctx) => {
      if (value === "false" || value === "") return false as const;
      const ipv4 = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
      const ipv6 = String.raw`[\da-fA-F]*:[\da-fA-F:.]*`;
      const entry = String.raw`(?:(?:${ipv4}|${ipv6})(?:/\d{1,3})?|loopback|linklocal|uniquelocal)`;
      if (new RegExp(String.raw`^${entry}(?:\s*,\s*${entry})*$`).test(value)) return value;
      ctx.addIssue({
        code: "custom",
        message: 'Use "false" or the proxy IP addresses, e.g. "10.0.0.0/8" or "loopback"',
      });
      return z.NEVER;
    }),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Signs login tokens. Anyone with this value can log in as any user.
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters")
    .refine((value) => !/replace-me|change-?me/i.test(value), {
      message: "JWT_SECRET is still the example placeholder. Generate a random one (see .env.example).",
    }),
  // How long a login lasts, e.g. "15m", "12h", "7d". Capped at 7 days.
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^[1-9]\d*[smhd]$/, 'Use a duration like "15m", "12h" or "7d"')
    .refine((value) => durationSeconds(value) <= MAX_TOKEN_LIFETIME_SECONDS, {
      message: "JWT_EXPIRES_IN can be at most 7 days",
    })
    .default("1d"),
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
