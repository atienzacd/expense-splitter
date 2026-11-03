import { createHash } from "node:crypto";
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
  | "access.denied"
  | "rate_limit.exceeded"
  | "group.member_added"
  | "expense.deleted";

const WARNING_EVENTS = new Set<SecurityEvent>([
  "auth.login_failed",
  "auth.token_rejected",
  "access.denied",
  "rate_limit.exceeded",
]);

/**
 * The same email always gives the same fingerprint, so repeated attempts
 * against one account can be correlated, but the address can't be read back.
 */
export function emailFingerprint(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 16);
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
export const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
];
