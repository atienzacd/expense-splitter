import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ana, loggedInAs, loggedOut, mockApi, renderAt, requestsMade } from "../test/render.tsx";

const invalidCredentials = {
  status: 401,
  body: { error: "InvalidCredentials", message: "Email or password is incorrect" },
};

async function fillLogin(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("logging in", () => {
  it("checks the fields before sending anything", async () => {
    const fetchMock = mockApi(loggedOut);
    renderAt("/login");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Log in" }));

    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter your email");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Enter your password");
    expect(requestsMade(fetchMock)).not.toContain("POST /api/auth/login");
  });

  it("says when the email or password is wrong, without saying which", async () => {
    mockApi({ ...loggedOut, "POST /api/auth/login": invalidCredentials });
    renderAt("/login");

    await fillLogin("ana@example.com", "wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });

  it("explains when there have been too many attempts", async () => {
    mockApi({ ...loggedOut, "POST /api/auth/login": { status: 429, body: { error: "TooManyRequests", message: "" } } });
    renderAt("/login");

    await fillLogin("ana@example.com", "guess");

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });

  it("logs in and goes to the groups page, with the name in the header", async () => {
    mockApi({ ...loggedOut, "POST /api/auth/login": { status: 200, body: { user: ana } } });
    renderAt("/login");

    await fillLogin("ana@example.com", "correct-horse-battery");

    expect(await screen.findByRole("heading", { name: "Your groups" })).toBeInTheDocument();
    const account = screen.getByRole("navigation", { name: "Account" });
    expect(within(account).getByText("Ana Santos")).toBeInTheDocument();
    expect(within(account).getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("sends logged-in users straight on", async () => {
    mockApi(loggedInAs(ana));
    renderAt("/login");

    expect(await screen.findByRole("heading", { name: "Your groups" })).toBeInTheDocument();
  });
});

describe("protected pages", () => {
  it("send visitors to log in, then back to where they were going", async () => {
    mockApi({ ...loggedOut, "POST /api/auth/login": { status: 200, body: { user: ana } } });
    const { router } = renderAt("/groups?tab=recent");

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    await fillLogin("ana@example.com", "correct-horse-battery");

    await screen.findByRole("heading", { name: "Your groups" });
    expect(router.state.location.pathname + router.state.location.search).toBe("/groups?tab=recent");
  });

  it("never return to another website after logging in", async () => {
    mockApi({ ...loggedOut, "POST /api/auth/login": { status: 200, body: { user: ana } } });
    const { router } = renderAt({ pathname: "/login", state: { from: "//evil.example/phish" } });

    await fillLogin("ana@example.com", "correct-horse-battery");

    await screen.findByRole("heading", { name: "Your groups" });
    expect(router.state.location.pathname).toBe("/groups");
  });
});

describe("signing up", () => {
  async function fillRegister(name: string, email: string, password: string) {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), name);
    await user.type(screen.getByLabelText("Email"), email);
    await user.type(screen.getByLabelText("Password"), password);
    await user.click(screen.getByRole("button", { name: "Create account" }));
  }

  it("asks for a password of at least 8 characters", async () => {
    const fetchMock = mockApi(loggedOut);
    renderAt("/register");

    expect(await screen.findByLabelText("Password")).toHaveAccessibleDescription("At least 8 characters.");
    await fillRegister("Ana", "ana@example.com", "short");

    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Use at least 8 characters");
    expect(requestsMade(fetchMock)).not.toContain("POST /api/auth/register");
  });

  it("points at the email field when the address is already registered", async () => {
    mockApi({
      ...loggedOut,
      "POST /api/auth/register": { status: 409, body: { error: "EmailTaken", message: "An account exists" } },
    });
    renderAt("/register");

    await fillRegister("Ana", "ana@example.com", "correct-horse-battery");

    expect(await screen.findByText("An account with this email already exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("creates the account and goes to the groups page", async () => {
    const fetchMock = mockApi({ ...loggedOut, "POST /api/auth/register": { status: 201, body: { user: ana } } });
    renderAt("/register");

    await fillRegister("  Ana Santos ", "Ana@Example.com", "correct-horse-battery");

    expect(await screen.findByRole("heading", { name: "Your groups" })).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/auth/register")!;
    const body = init?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string)).toEqual({
      name: "Ana Santos",
      email: "Ana@Example.com",
      password: "correct-horse-battery",
    });
  });
});

describe("logging out", () => {
  it("ends the session on the server and returns to the home page", async () => {
    const fetchMock = mockApi({ ...loggedInAs(ana), "POST /api/auth/logout": { status: 204 } });
    const { router } = renderAt("/groups");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Log out" }));

    const account = await screen.findByRole("navigation", { name: "Account" });
    expect(await within(account).findByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(requestsMade(fetchMock)).toContain("POST /api/auth/logout");
    expect(router.state.location.pathname).toBe("/");
  });
});
