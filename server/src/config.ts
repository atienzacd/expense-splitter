import { isIP } from "node:net";
import { z } from "zod";

const DURATION = /^[1-9]\d*[smhd]$/;
const DURATION_SECONDS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** Converts a duration like "15m" or "14d" to seconds. */
export function durationSeconds(value: string): number {
  const unit = value.at(-1) as keyof typeof DURATION_SECONDS;
  return Number(value.slice(0, -1)) * DURATION_SECONDS[unit];
}

// Named ranges understood by Fastify's proxy-addr: this machine, link-local
// and private networks. Each only covers addresses a public client can't use.
const PROXY_RANGE_NAMES = new Set(["loopback", "linklocal", "uniquelocal"]);
// The widest ranges accepted. Anything wider (like 0.0.0.0/0, "everyone")
// would let ordinary clients set their own IP, the same as trusting everybody.
const MIN_PREFIX = { 4: 8, 6: 16 } as const;

function isTrustedProxyEntry(entry: string): boolean {
  if (PROXY_RANGE_NAMES.has(entry)) return true;

  const [address = "", prefix, ...rest] = entry.split("/");
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;

  const [minPrefix, maxPrefix] = family === 4 ? [MIN_PREFIX[4], 32] : [MIN_PREFIX[6], 128];
  const bits = Number(prefix);
  return /^\d{1,3}$/.test(prefix) && bits >= minPrefix && bits <= maxPrefix;
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
      const invalid = value.split(",").map((entry) => entry.trim()).filter((entry) => !isTrustedProxyEntry(entry));
      if (invalid.length === 0) return value;
      ctx.addIssue({
        code: "custom",
        message:
          `Not a valid proxy address: ${invalid.join(", ")}. Use "false" or the proxy's own addresses, ` +
          'e.g. "10.1.2.3", "10.0.0.0/8" or "loopback". Ranges wider than /8 (IPv4) or /16 (IPv6) are refused.',
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
  // How long an access token (the cookie sent with every API request) lasts.
  // Kept short: the browser gets a new one from the refresh token automatically.
  ACCESS_TOKEN_TTL: duration("ACCESS_TOKEN_TTL", 60 * 60, "1 hour").default("15m"),
  // How long a login lasts on one device without being used. Each refresh
  // starts a new period, and logging out ends it immediately.
  REFRESH_TOKEN_TTL: duration("REFRESH_TOKEN_TTL", 90 * 86_400, "90 days").default("14d"),
  // Web origins allowed to make changes through the API, e.g.
  // "https://splitter.example.com". Requests from any other site are refused.
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173")
    .transform((value, ctx) => {
      const origins = value.split(",").map((entry) => entry.trim()).filter(Boolean);
      const invalid = origins.filter((origin) => !isOrigin(origin));
      if (origins.length > 0 && invalid.length === 0) return origins;
      ctx.addIssue({
        code: "custom",
        message: `Not a valid origin: ${invalid.join(", ") || "(empty)"}. Use e.g. "https://splitter.example.com".`,
      });
      return z.NEVER;
    }),
  // Login cookies are only sent over HTTPS. Browsers treat http://localhost as
  // secure, so this stays on in development too; turn it off only if your
  // browser refuses cookies on a plain-HTTP development address.
  COOKIE_SECURE: z.stringbool().default(true),
  // Folder with the built web app to host alongside the API (set in Docker).
  STATIC_DIR: z.string().min(1).optional(),
});

/** A duration like "15m", "12h" or "7d", with an upper limit. */
function duration(name: string, maxSeconds: number, maxLabel: string) {
  return (
    z
      .string()
      .regex(DURATION, 'Use a duration like "15m", "12h" or "7d"')
      // Only checked for well-formed durations, so a typo gets one clear message.
      .refine((value) => !DURATION.test(value) || durationSeconds(value) <= maxSeconds, {
        message: `${name} can be at most ${maxLabel}`,
      })
  );
}

/** An origin is a scheme and host (and port), with no path, like the browser's Origin header. */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}

export type Config = z.infer<typeof envSchema>;

/** Reads settings from environment variables and fails fast if any are invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
