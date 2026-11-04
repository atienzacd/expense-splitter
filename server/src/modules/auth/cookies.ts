import type { CookieSerializeOptions } from "@fastify/cookie";
import type { FastifyReply } from "fastify";

/**
 * Login cookies. Both are httpOnly (page scripts can't read them, so an XSS
 * bug can't steal them) and SameSite=Strict (other sites can't make the
 * browser send them).
 */

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

// The access token goes with every API request; the refresh token only to
// the auth routes that need it.
const ACCESS_PATH = "/api";
const REFRESH_PATH = "/api/auth";

export type CookieSettings = {
  secure: boolean;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
};

function base(secure: boolean, path: string): CookieSerializeOptions {
  return { httpOnly: true, secure, sameSite: "strict", path };
}

export function setLoginCookies(
  reply: FastifyReply,
  settings: CookieSettings,
  tokens: { accessToken: string; refreshToken: string },
): void {
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(settings.secure, ACCESS_PATH),
    maxAge: settings.accessTtlSeconds,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(settings.secure, REFRESH_PATH),
    maxAge: settings.refreshTtlSeconds,
  });
}

export function clearLoginCookies(reply: FastifyReply, settings: CookieSettings): void {
  reply.clearCookie(ACCESS_COOKIE, base(settings.secure, ACCESS_PATH));
  reply.clearCookie(REFRESH_COOKIE, base(settings.secure, REFRESH_PATH));
}
