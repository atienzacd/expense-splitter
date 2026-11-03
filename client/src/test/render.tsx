import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { routes } from "../routes.tsx";

/** Renders the real app at `path`, with a fresh query cache and no retries. */
export function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
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
