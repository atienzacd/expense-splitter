import { createHmac } from "node:crypto";
import type { FastifyRequest } from "fastify";

/**
 * Security event logging (ISO 27001 Annex A 8.15 Logging, 8.16 Monitoring).
 *
 * Each event is one structured log line with a stable `securityEvent` name, so
 * a log platform can alert on spikes (e.g. many `auth.login_failed`). Events
 * never contain passwords or tokens, and emails are pseudonymised.
 */

export type SecurityEvent =
  | "auth.registered"
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.token_rejected"
  | "auth.refresh_token_reused"
  | "auth.logged_out"
  | "request.cross_site_blocked"
  | "access.denied"
  | "rate_limit.exceeded"
  | "group.member_added"
  | "expense.created"
  | "expense.deleted"
  | "settlement.created";

const WARNING_EVENTS = new Set<SecurityEvent>([
  "auth.login_failed",
  "auth.token_rejected",
  "auth.refresh_token_reused",
  "request.cross_site_blocked",
  "access.denied",
  "rate_limit.exceeded",
]);

/**
 * Builds a keyed (HMAC) email fingerprint for logs. The same email always gives
 * the same fingerprint, so repeated attempts against one account can be
 * correlated. Because it is keyed with a server secret, someone holding only
 * the logs can't confirm a guessed address by hashing it themselves, which a
 * plain hash would allow.
 */
export function createEmailFingerprinter(serverSecret: string): (email: string) => string {
  // A separate key derived from the secret, so this use can't interfere with token signing.
  const key = createHmac("sha256", serverSecret).update("log-email-fingerprint").digest();
  return (email) => createHmac("sha256", key).update(email).digest("hex").slice(0, 16);
}

export function logSecurityEvent(
  request: FastifyRequest,
  event: SecurityEvent,
  details: Record<string, string | number | undefined> = {},
): void {
  const entry = { securityEvent: event, ip: request.ip, ...details };
  if (WARNING_EVENTS.has(event)) {
    request.log.warn(entry, `security: ${event}`);
  } else {
    request.log.info(entry, `security: ${event}`);
  }
}

/**
 * Log fields that must never be written in clear text (Annex A 8.11 Data
 * masking, 8.12 Data leakage prevention). Applied even though the default
 * request serializer doesn't log headers or bodies, in case that changes.
 */
const SECRET_FIELDS = ["password", "passwordHash", "token"];

// pino redaction has no "any depth" wildcard, so each field is listed at the
// top level and up to three levels deep (e.g. { body: { user: { password } } }).
export const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  ...SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`, `*.*.*.${field}`]),
];
