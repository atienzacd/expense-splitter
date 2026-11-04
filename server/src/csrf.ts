import type { FastifyReply, FastifyRequest } from "fastify";
import { logSecurityEvent } from "./security.ts";

/**
 * Cross-site request forgery (CSRF) protection.
 *
 * Login cookies are SameSite=Strict, so browsers already refuse to send them
 * with requests started by other sites. This is a second, independent check:
 * a request that changes data is refused when the browser says it came from
 * another site, either through Sec-Fetch-Site (sent by all modern browsers) or
 * an Origin that isn't one of ours. Requests without either header don't come
 * from a web page (e.g. curl), so they can't ride on a victim's cookies.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// "none" means the user typed the address or used a bookmark.
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

export function createCrossSiteGuard(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);

  return async function crossSiteGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (SAFE_METHODS.has(request.method)) return;

    const fetchSite = request.headers["sec-fetch-site"];
    const origin = request.headers.origin;
    const fromOtherSite =
      (fetchSite !== undefined && !ALLOWED_FETCH_SITES.has(fetchSite)) ||
      (origin !== undefined && !allowed.has(origin));

    if (fromOtherSite) {
      logSecurityEvent(request, "request.cross_site_blocked", {
        origin: origin ?? "none",
        fetchSite: fetchSite ?? "none",
        route: request.routeOptions.url,
      });
      return reply.status(403).send({
        error: "CrossSiteRequestBlocked",
        message: "This request came from another website and was blocked.",
      });
    }
  };
}
