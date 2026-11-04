import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ana, healthy, loggedInAs, loggedOut, mockApi, renderAt } from "../test/render.tsx";

describe("home page", () => {
  it("introduces the app and invites visitors to sign up or log in", async () => {
    mockApi(loggedOut);
    renderAt("/");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Split bills");
    expect(screen.getByRole("link", { name: "Expense Splitter" })).toHaveAttribute("href", "/");
    expect(await screen.findByRole("link", { name: "Get started" })).toHaveAttribute("href", "/register");
  });

  it("sends logged-in users to their groups", async () => {
    mockApi(loggedInAs(ana));
    renderAt("/");

    expect(await screen.findByRole("link", { name: "Go to your groups" })).toHaveAttribute("href", "/groups");
    expect(screen.queryByRole("link", { name: "Get started" })).not.toBeInTheDocument();
  });

  it("shows when the server is online", async () => {
    const fetchMock = mockApi(loggedOut);
    renderAt("/");

    expect(screen.getByRole("status")).toHaveTextContent("Checking the server");
    await screen.findByText("Server online, database connected");
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("shows when the server or database is down", async () => {
    mockApi({ ...loggedOut, "GET /api/health": { status: 503, body: { status: "error", database: "unreachable" } } });
    renderAt("/");

    expect(await screen.findByText(/Server unavailable/)).toBeInTheDocument();
  });
});

describe("unknown pages", () => {
  it("show a not-found page with a way home", () => {
    mockApi(healthy);
    renderAt("/no/such/page");

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
  });
});
