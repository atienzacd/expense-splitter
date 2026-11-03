/**
 * An error that maps directly to an HTTP response. Throw it from a route and
 * the app's error handler replies with `{ error: code, message }`.
 */
export class HttpError extends Error {
  override name = "HttpError";
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
