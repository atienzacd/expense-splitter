import { describe, expect, it, vi } from "vitest";
import { mockFetch } from "../test/render.tsx";
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
