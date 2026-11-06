/**
 * The one place the app talks to the server. Every request goes to `/api/...`
 * on the same origin, and failures become an `ApiError` carrying the server's
 * `{ error, message }` so screens can show a helpful message.
 *
 * Login lives in httpOnly cookies the browser sends by itself. The access
 * cookie expires after a few minutes; when a request comes back 401, this
 * module renews it once through /auth/refresh and retries, so the user never
 * notices.
 */

export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type ErrorBody = { error?: unknown; message?: unknown };

// Calls that must not trigger a refresh: they either are the refresh, or a
// 401 from them means wrong credentials rather than an expired session.
const NO_REFRESH = new Set(["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"]);

function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
}

// While a refresh is in flight, every request that hits a 401 waits for the
// same one, so a page loading several things at once refreshes only once.
let refreshing: Promise<boolean> | undefined;

// How long to wait for another tab's renewed cookies to arrive.
const SUPERSEDED_WAIT_MS = 500;

/** Renews the login cookies. Resolves false when there is no session to renew. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= send("/auth/refresh", { method: "POST" })
    .then(async (response) => {
      // 409: another tab renewed the login at the same moment, and the browser
      // gets its new cookies (shared between tabs). Give them a moment to land.
      if (response.status === 409) {
        await new Promise((resolve) => setTimeout(resolve, SUPERSEDED_WAIT_MS));
        return true;
      }
      return response.ok;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

async function toResult<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const { error, message } = (body ?? {}) as ErrorBody;
    throw new ApiError(
      response.status,
      typeof error === "string" ? error : "RequestFailed",
      typeof message === "string" ? message : `Request failed (${response.status})`,
    );
  }
  return body as T;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await send(path, init);
  if (response.status === 401 && !NO_REFRESH.has(path) && (await refreshSession())) {
    response = await send(path, init);
  }
  return toResult<T>(response);
}

/** Sends `data` as a JSON POST. */
export function post<T>(path: string, data?: unknown): Promise<T> {
  return api<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
}

/**
 * The server's own message when it refused because a limit was reached (it
 * says which, and what to do), otherwise `fallback`.
 */
export function limitMessageOr(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.code === "LimitReached" ? error.message : fallback;
}
