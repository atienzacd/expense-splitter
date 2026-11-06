import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ana, loggedInAs, mockApi, renderAt } from "../test/render.tsx";

const groupId = "0196f3a0-0000-7000-8000-0000000000a1";
const ben = { id: "0196f3a0-0000-7000-8000-000000000002", name: "Ben Cruz", email: "ben@example.com", isGuest: false };
const joined = "2026-11-04T00:00:00.000Z";

const trip = {
  id: groupId,
  name: "Japan trip",
  currency: "PHP",
  createdAt: joined,
  createdById: ana.id,
  members: [{ ...ana, isGuest: false }, ben].map((m) => ({ ...m, joinedAt: joined })),
};

const ramen = {
  id: "e1",
  description: "Ramen",
  amount: 119_268,
  original: { currency: "JPY", amount: 3000, exchangeRate: "0.39756" },
  splitType: "EQUAL",
  createdAt: joined,
  paidBy: { id: ana.id, name: ana.name },
  splits: [
    { userId: ana.id, amountOwed: 59_634 },
    { userId: ben.id, amountOwed: 59_634 },
  ],
};

function api(extra = {}, group: object = trip) {
  return {
    ...loggedInAs(ana),
    [`GET /api/groups/${groupId}`]: { status: 200, body: { group } },
    [`GET /api/groups/${groupId}/invitations`]: { status: 200, body: { invitations: [] } },
    [`GET /api/groups/${groupId}/expenses`]: { status: 200, body: { expenses: [] } },
    [`GET /api/groups/${groupId}/balances`]: { status: 200, body: { balances: [], transfers: [] } },
    [`GET /api/groups/${groupId}/settlements`]: { status: 200, body: { settlements: [] } },
    "GET /api/rates?from=JPY&to=PHP": { status: 200, body: { from: "JPY", to: "PHP", rate: "0.39756", date: "2026-11-05" } },
    ...extra,
  };
}

function bodyOf(fetchMock: ReturnType<typeof mockApi>, method: string, url: string) {
  const [, init] = fetchMock.mock.calls.find(([u, req]) => u === url && req?.method === method)!;
  return JSON.parse(init?.body as string);
}

const posted = (fetchMock: ReturnType<typeof mockApi>, url: string) =>
  fetchMock.mock.calls.some(([u, req]) => u === url && req?.method === "POST");

describe("choosing a group's currency", () => {
  it("sends the chosen currency when creating a group", async () => {
    const fetchMock = mockApi({
      ...loggedInAs(ana),
      "GET /api/invitations": { status: 200, body: { invitations: [] } },
      "GET /api/groups": { status: 200, body: { groups: [] } },
      "POST /api/groups": { status: 201, body: { group: { id: groupId, name: "New York", currency: "USD", createdAt: "" } } },
      [`GET /api/groups/${groupId}`]: { status: 200, body: { group: { ...trip, name: "New York", currency: "USD" } } },
    });
    renderAt("/groups");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Group name"), "New York");
    await user.selectOptions(screen.getByLabelText("Settle up in"), "USD — US Dollar");
    await user.click(screen.getByRole("button", { name: "Create group" }));

    await screen.findByRole("heading", { name: "New York", level: 1 });
    expect(bodyOf(fetchMock, "POST", "/api/groups")).toEqual({ name: "New York", currency: "USD" });
  });

  it("shows balances in the group's currency", async () => {
    mockApi(
      api(
        {
          [`GET /api/groups/${groupId}/balances`]: {
            status: 200,
            body: {
              balances: [
                { userId: ana.id, name: ana.name, isGuest: false, net: 1234 },
                { userId: ben.id, name: ben.name, isGuest: false, net: -1234 },
              ],
              transfers: [{ fromUserId: ben.id, toUserId: ana.id, amount: 1234 }],
            },
          },
        },
        { ...trip, currency: "USD" },
      ),
    );
    renderAt(`/groups/${groupId}`);

    const balances = await screen.findByRole("region", { name: "Balances" });
    expect(await within(balances).findByText("gets back $12.34")).toBeInTheDocument();
    expect(within(balances).getByText("Ben Cruz pays you $12.34")).toBeInTheDocument();
  });
});

describe("adding an expense in another currency", () => {
  it("suggests today's rate, shows the converted total and sends what was paid", async () => {
    const fetchMock = mockApi(
      api({ [`POST /api/groups/${groupId}/expenses`]: { status: 201, body: { expense: ramen } } }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Description"), "Ramen");
    await user.selectOptions(screen.getByLabelText("Currency"), "JPY — Japanese Yen");
    await user.type(screen.getByLabelText("Amount (¥)"), "3,000");

    const rate = await screen.findByLabelText("Exchange rate: 1 JPY in PHP");
    expect(rate).toHaveValue("0.39756");
    expect(rate).toHaveAccessibleDescription(/European Central Bank rate for Nov 5, 2026/);
    expect(screen.getByText("¥3,000 = ₱1,192.68")).toBeInTheDocument();
    // Equal shares are shown in the group's currency, as they'll be owed.
    expect(screen.getAllByText("₱596.34")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await expect.poll(() => posted(fetchMock, `/api/groups/${groupId}/expenses`)).toBe(true);
    expect(bodyOf(fetchMock, "POST", `/api/groups/${groupId}/expenses`)).toEqual({
      description: "Ramen",
      amount: 3000,
      currency: "JPY",
      exchangeRate: "0.39756",
      paidById: ana.id,
      split: { type: "EQUAL", userIds: [ana.id, ben.id] },
    });
  });

  it("lets you type the rate you were charged, especially when none can be fetched", async () => {
    const fetchMock = mockApi(
      api({
        "GET /api/rates?from=JPY&to=PHP": { status: 503, body: { error: "RatesUnavailable", message: "Couldn't get the exchange rate" } },
        [`POST /api/groups/${groupId}/expenses`]: { status: 201, body: { expense: ramen } },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Description"), "Ramen");
    await user.selectOptions(screen.getByLabelText("Currency"), "JPY — Japanese Yen");
    await user.type(screen.getByLabelText("Amount (¥)"), "3000");
    const rate = screen.getByLabelText("Exchange rate: 1 JPY in PHP");
    expect(await screen.findByText(/Couldn't get today's rate/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add expense" }));
    expect(rate).toHaveAccessibleDescription("Enter the rate, like 0.3976");

    await user.type(rate, "0.4");
    expect(screen.getByText("¥3,000 = ₱1,200.00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await expect.poll(() => posted(fetchMock, `/api/groups/${groupId}/expenses`)).toBe(true);
    expect(bodyOf(fetchMock, "POST", `/api/groups/${groupId}/expenses`)).toMatchObject({ amount: 3000, exchangeRate: "0.4" });
  });
});

describe("expenses paid in another currency", () => {
  it("show what was actually paid and the rate used", async () => {
    mockApi(api({ [`GET /api/groups/${groupId}/expenses`]: { status: 200, body: { expenses: [ramen] } } }));
    renderAt(`/groups/${groupId}`);

    const list = await screen.findByRole("region", { name: "Expenses" });
    expect(await within(list).findByText("₱1,192.68")).toBeInTheDocument();
    expect(within(list).getByText(/Paid ¥3,000 · 1 JPY = 0.39756 PHP/)).toBeInTheDocument();
  });
});
