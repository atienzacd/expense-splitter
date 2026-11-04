import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, type InitialEntry, RouterProvider } from "react-router";
import { vi } from "vitest";
import type { User } from "../api/auth.ts";
import { createQueryClient } from "../queryClient.ts";
import { routes } from "../routes.tsx";

/** Renders the real app at `entry` (a path, or a path with router state), with a fresh cache and no retries. */
export function renderAt(entry: InitialEntry) {
  const queryClient = createQueryClient({ retry: false });
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient };
}

/**
 * Pretends the device is in light or dark mode. Returns a function that
 * switches the device setting later, firing the change event like a browser.
 */
export function mockSystemTheme(initial: "light" | "dark") {
  let dark = initial === "dark";
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query.includes("dark") ? dark : !dark;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  return (next: "light" | "dark") => {
    dark = next === "dark";
    for (const listener of listeners) listener();
  };
}

/** Replaces `fetch` with one that answers every request with `status` and `body`. */
export function mockFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    body === undefined ? new Response(null, { status }) : Response.json(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type Reply = { status: number; body?: unknown };

function pathOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
}
type Handler = Reply | ((init: RequestInit | undefined) => Reply);

/**
 * A fake API: `handlers` maps "METHOD /api/path" to a reply (or a function
 * returning one). Anything not listed answers 404, like the real server.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const handler = handlers[`${init?.method ?? "GET"} ${pathOf(input)}`] ?? {
      status: 404,
      body: { error: "NotFound", message: "Not found" },
    };
    const { status, body } = typeof handler === "function" ? handler(init) : handler;
    return body === undefined ? new Response(null, { status }) : Response.json(body, { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The requests `fetchMock` received, as "METHOD /api/path". */
export function requestsMade(fetchMock: ReturnType<typeof mockApi>): string[] {
  return fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? "GET"} ${pathOf(input)}`);
}

export const healthy: Record<string, Reply> = {
  "GET /api/health": { status: 200, body: { status: "ok", database: "ok" } },
};

/** Nobody is logged in: /me is refused and there is no session to refresh. */
export const loggedOut: Record<string, Reply> = {
  ...healthy,
  "GET /api/auth/me": { status: 401, body: { error: "Unauthorized", message: "Log in to continue" } },
  "POST /api/auth/refresh": { status: 401, body: { error: "SessionExpired", message: "Your session has ended." } },
};

export const ana: User = { id: "0196f3a0-0000-7000-8000-000000000001", name: "Ana Santos", email: "ana@example.com" };

export function loggedInAs(user: User): Record<string, Reply> {
  return { ...healthy, "GET /api/auth/me": { status: 200, body: { user } } };
}
