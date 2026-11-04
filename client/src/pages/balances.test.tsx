import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ana, loggedInAs, mockApi, renderAt, requestsMade } from "../test/render.tsx";

const groupId = "0196f3a0-0000-7000-8000-0000000000a1";
const ben = { id: "0196f3a0-0000-7000-8000-000000000002", name: "Ben Cruz", email: "ben@example.com" };
const cara = { id: "0196f3a0-0000-7000-8000-000000000003", name: "Cara Reyes", email: "cara@example.com" };
const joined = "2026-11-04T00:00:00.000Z";

const group = {
  id: groupId,
  name: "Baguio trip",
  createdAt: joined,
  createdById: ana.id,
  members: [ana, ben, cara].map((m) => ({ ...m, joinedAt: joined })),
};

// Hotel ₱9,000 paid by Ana, taho ₱150 paid by Ben, gas ₱2,400 paid by Cara (50/25/25).
const unsettled = {
  balances: [
    { userId: ana.id, name: ana.name, net: 475_000 },
    { userId: ben.id, name: ben.name, net: -350_000 },
    { userId: cara.id, name: cara.name, net: -125_000 },
  ],
  transfers: [
    { fromUserId: ben.id, toUserId: ana.id, amount: 350_000 },
    { fromUserId: cara.id, toUserId: ana.id, amount: 125_000 },
  ],
};

const settled = {
  balances: unsettled.balances.map((b) => ({ ...b, net: 0 })),
  transfers: [],
};

function api(me: typeof ana, extra = {}) {
  return {
    ...loggedInAs(me),
    [`GET /api/groups/${groupId}`]: { status: 200, body: { group } },
    [`GET /api/groups/${groupId}/invitations`]: { status: 200, body: { invitations: [] } },
    [`GET /api/groups/${groupId}/expenses`]: { status: 200, body: { expenses: [] } },
    [`GET /api/groups/${groupId}/balances`]: { status: 200, body: unsettled },
    [`GET /api/groups/${groupId}/settlements`]: { status: 200, body: { settlements: [] } },
    ...extra,
  };
}

const balancesCard = () => screen.findByRole("region", { name: "Balances" });

describe("balances", () => {
  it("shows who gets money back, who owes, and the fewest payments", async () => {
    mockApi(api(ana));
    renderAt(`/groups/${groupId}`);

    const card = await balancesCard();
    expect(await within(card).findByText("gets back ₱4,750.00")).toBeInTheDocument();
    expect(within(card).getByText("owes ₱3,500.00")).toBeInTheDocument();
    expect(within(card).getByText("owes ₱1,250.00")).toBeInTheDocument();

    const payments = within(card).getByRole("region", { name: "Who pays whom" });
    expect(payments).toHaveTextContent("Ben Cruz pays you ₱3,500.00");
    expect(payments).toHaveTextContent("Cara Reyes pays you ₱1,250.00");
    // Ana is owed; only the person paying can mark a payment as made.
    expect(within(payments).queryByRole("button", { name: "Mark as paid" })).not.toBeInTheDocument();
    expect(payments).toHaveTextContent("Ben Cruz marks it as paid after paying you.");
  });

  it("says so when everyone is settled up", async () => {
    mockApi(api(ana, { [`GET /api/groups/${groupId}/balances`]: { status: 200, body: settled } }));
    renderAt(`/groups/${groupId}`);

    const card = await balancesCard();
    expect(await within(card).findByText("Everyone is settled up.")).toBeInTheDocument();
    expect(within(card).getAllByText("settled up")).toHaveLength(3);
  });
});

describe("marking a payment as paid", () => {
  it("asks first, records the payment, and updates the balances", async () => {
    let paid = false;
    const fetchMock = mockApi(
      api(ben, {
        [`GET /api/groups/${groupId}/balances`]: () => ({
          status: 200,
          body: paid
            ? { balances: unsettled.balances, transfers: [unsettled.transfers[1]] }
            : unsettled,
        }),
        [`POST /api/groups/${groupId}/settlements`]: (init: RequestInit | undefined) => {
          paid = true;
          return { status: 201, body: { settlement: { id: "s1", ...JSON.parse(init?.body as string) } } };
        },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    const card = await balancesCard();
    const payments = await within(card).findByRole("region", { name: "Who pays whom" });
    expect(await within(payments).findByText("You pay Ana Santos ₱3,500.00")).toBeInTheDocument();

    await user.click(within(payments).getByRole("button", { name: "Mark as paid" }));
    expect(within(payments).getByText(/Record that you paid Ana Santos ₱3,500.00\?/)).toBeInTheDocument();
    expect(requestsMade(fetchMock)).not.toContain(`POST /api/groups/${groupId}/settlements`);

    await user.click(within(payments).getByRole("button", { name: "Yes, I've paid" }));

    await expect.poll(() => within(payments).queryByText("You pay Ana Santos ₱3,500.00")).toBeNull();
    const [, init] = fetchMock.mock.calls.find(([url, req]) => url === `/api/groups/${groupId}/settlements` && req?.method === "POST")!;
    expect(JSON.parse(init?.body as string)).toEqual({ toUserId: ana.id, amount: 350_000 });
  });

  it("can be cancelled", async () => {
    const fetchMock = mockApi(api(ben));
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Mark as paid" }));
    await user.click(screen.getByRole("button", { name: "Not yet" }));

    expect(screen.getByRole("button", { name: "Mark as paid" })).toBeInTheDocument();
    expect(requestsMade(fetchMock)).not.toContain(`POST /api/groups/${groupId}/settlements`);
  });
});

describe("recording a different payment", () => {
  it("records a partial payment to the chosen person", async () => {
    const fetchMock = mockApi(
      api(ben, {
        [`POST /api/groups/${groupId}/settlements`]: { status: 201, body: { settlement: { id: "s1" } } },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByText("Record a different payment"));
    await user.selectOptions(screen.getByLabelText("You paid"), "Ana Santos");
    await user.type(screen.getByLabelText("Amount paid (₱)"), "1,000");
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(await screen.findByText("Recorded ₱1,000.00 to Ana Santos.")).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls.find(([url, req]) => url === `/api/groups/${groupId}/settlements` && req?.method === "POST")!;
    expect(JSON.parse(init?.body as string)).toEqual({ toUserId: ana.id, amount: 100_000 });
  });

  it("checks the amount first", async () => {
    const fetchMock = mockApi(api(ben));
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByText("Record a different payment"));
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(screen.getByLabelText("Amount paid (₱)")).toHaveAccessibleDescription("Enter an amount like 150 or 150.75");
    expect(requestsMade(fetchMock)).not.toContain(`POST /api/groups/${groupId}/settlements`);
  });
});

describe("payment history", () => {
  it("lists recorded payments, newest first as the server sends them", async () => {
    mockApi(
      api(ana, {
        [`GET /api/groups/${groupId}/settlements`]: {
          status: 200,
          body: {
            settlements: [
              { id: "s2", fromUserId: cara.id, toUserId: ana.id, amount: 125_000, createdAt: "2026-11-04T09:00:00.000Z" },
              { id: "s1", fromUserId: ben.id, toUserId: ana.id, amount: 350_000, createdAt: "2026-11-03T09:00:00.000Z" },
            ],
          },
        },
      }),
    );
    renderAt(`/groups/${groupId}`);

    const card = await screen.findByRole("region", { name: "Payments" });
    const rows = await within(card).findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Cara Reyes paid you₱1,250.00"),
      expect.stringContaining("Ben Cruz paid you₱3,500.00"),
    ]);
  });

  it("explains when nothing has been paid yet", async () => {
    mockApi(api(ana));
    renderAt(`/groups/${groupId}`);

    const card = await screen.findByRole("region", { name: "Payments" });
    expect(await within(card).findByText("No payments recorded yet.")).toBeInTheDocument();
  });
});
