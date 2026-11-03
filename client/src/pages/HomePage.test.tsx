import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockFetch, renderAt } from "../test/render.tsx";

describe("home page", () => {
  it("introduces the app", async () => {
    mockFetch(200, { status: "ok", database: "ok" });
    renderAt("/");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Split bills");
    expect(screen.getByRole("link", { name: "Expense Splitter" })).toHaveAttribute("href", "/");
    await screen.findByText("Server online, database connected");
  });

  it("shows when the server is online", async () => {
    const fetchMock = mockFetch(200, { status: "ok", database: "ok" });
    renderAt("/");

    expect(screen.getByRole("status")).toHaveTextContent("Checking the server");
    await screen.findByText("Server online, database connected");
    expect(screen.getByRole("status")).toHaveTextContent("Server online, database connected");
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("shows when the server or database is down", async () => {
    mockFetch(503, { status: "error", database: "unreachable" });
    renderAt("/");

    expect(await screen.findByText(/Server unavailable/)).toBeInTheDocument();
  });
});

describe("unknown pages", () => {
  it("show a not-found page with a way home", () => {
    mockFetch(200, {});
    renderAt("/no/such/page");

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
  });
});
