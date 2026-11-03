/**
 * The one place the app talks to the server. Every request goes to `/api/...`
 * on the same origin, and failures become an `ApiError` carrying the server's
 * `{ error, message }` so screens can show a helpful message.
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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
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
