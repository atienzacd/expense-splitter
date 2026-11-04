import { describe, expect, it, vi } from "vitest";
import { mockApi, mockFetch, requestsMade } from "../test/render.tsx";
import { api, ApiError } from "./client.ts";

describe("api", () => {
  it("calls the same-origin /api path and returns the JSON body", async () => {
    const fetchMock = mockFetch(200, { hello: "world" });

    await expect(api("/things")).resolves.toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledWith("/api/things", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("sends JSON bodies with a JSON content type", async () => {
    const fetchMock = mockFetch(201, { ok: true });

    await api("/things", { method: "POST", body: JSON.stringify({ name: "Trip" }) });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetch(204);
    await expect(api("/things/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("turns error responses into an ApiError with the server's code and message", async () => {
    mockFetch(409, { error: "EmailTaken", message: "An account with this email already exists" });

    const error = await api("/auth/register").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "EmailTaken",
      message: "An account with this email already exists",
    });
  });

  it("still gives a readable error when the response isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Bad Gateway</html>", { status: 502 })),
    );

    await expect(api("/things")).rejects.toMatchObject({
      status: 502,
      code: "RequestFailed",
      message: "Request failed (502)",
    });
  });
});

describe("renewing an expired login", () => {
  const expired = { status: 401, body: { error: "Unauthorized", message: "Log in to continue" } };

  it("refreshes the session once and retries the request", async () => {
    let groupCalls = 0;
    const fetchMock = mockApi({
      "GET /api/groups": () => (++groupCalls === 1 ? expired : { status: 200, body: { groups: [] } }),
      "POST /api/auth/refresh": { status: 200, body: { user: {} } },
    });

    await expect(api("/groups")).resolves.toEqual({ groups: [] });
    expect(requestsMade(fetchMock)).toEqual(["GET /api/groups", "POST /api/auth/refresh", "GET /api/groups"]);
  });

  it("gives up with a 401 when the session can't be renewed", async () => {
    const fetchMock = mockApi({
      "GET /api/groups": expired,
      "POST /api/auth/refresh": { status: 401, body: { error: "SessionExpired", message: "Ended" } },
    });

    await expect(api("/groups")).rejects.toMatchObject({ status: 401 });
    expect(requestsMade(fetchMock)).toEqual(["GET /api/groups", "POST /api/auth/refresh"]);
  });

  it("shares one refresh between requests that expire at the same time", async () => {
    let refreshed = false;
    const fetchMock = mockApi({
      "GET /api/groups": () => (refreshed ? { status: 200, body: [] } : expired),
      "GET /api/auth/me": () => (refreshed ? { status: 200, body: {} } : expired),
      "POST /api/auth/refresh": () => {
        refreshed = true;
        return { status: 200, body: {} };
      },
    });

    await Promise.all([api("/groups"), api("/auth/me")]);
    expect(requestsMade(fetchMock).filter((r) => r === "POST /api/auth/refresh")).toHaveLength(1);
  });

  it("doesn't refresh when logging in fails, since that 401 means wrong credentials", async () => {
    const fetchMock = mockApi({ "POST /api/auth/login": expired });

    await expect(api("/auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 401 });
    expect(requestsMade(fetchMock)).toEqual(["POST /api/auth/login"]);
  });
});
