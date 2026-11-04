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

const hotel = {
  id: "0196f3a0-0000-7000-8000-0000000000e1",
  description: "Hotel",
  amount: 900_000,
  splitType: "EQUAL",
  createdAt: "2026-11-03T10:00:00.000Z",
  paidBy: { id: ana.id, name: ana.name },
  splits: [
    { userId: ana.id, amountOwed: 300_000 },
    { userId: ben.id, amountOwed: 300_000 },
    { userId: "0196f3a0-0000-7000-8000-00000000dead", amountOwed: 300_000 },
  ],
};

function api(expenses: unknown[] = [], extra = {}) {
  return {
    ...loggedInAs(ana),
    [`GET /api/groups/${groupId}`]: { status: 200, body: { group } },
    [`GET /api/groups/${groupId}/invitations`]: { status: 200, body: { invitations: [] } },
    [`GET /api/groups/${groupId}/expenses`]: { status: 200, body: { expenses } },
    [`GET /api/groups/${groupId}/balances`]: { status: 200, body: { balances: [], transfers: [] } },
    [`GET /api/groups/${groupId}/settlements`]: { status: 200, body: { settlements: [] } },
    ...extra,
  };
}

/** The JSON body of the last POST to the expenses endpoint. */
function sentExpense(fetchMock: ReturnType<typeof mockApi>): unknown {
  const call = fetchMock.mock.calls.findLast(
    ([url, init]) => url === `/api/groups/${groupId}/expenses` && init?.method === "POST",
  );
  const body = call?.[1]?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

async function fillBasics(description: string, amount: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Description"), description);
  await user.type(screen.getByLabelText("Amount (₱)"), amount);
  return user;
}

describe("expenses list", () => {
  it("shows each expense in pesos with who paid and everyone's share", async () => {
    mockApi(api([hotel]));
    renderAt(`/groups/${groupId}`);

    const list = await screen.findByRole("region", { name: "Expenses" });
    expect(await within(list).findByRole("heading", { name: "Hotel" })).toBeInTheDocument();
    expect(within(list).getByText("₱9,000.00")).toBeInTheDocument();
    expect(within(list).getByText(/You paid/)).toBeInTheDocument();
    const shares = within(list).getByRole("list", { name: "Shares of Hotel" });
    expect(shares).toHaveTextContent("You ₱3,000.00");
    expect(shares).toHaveTextContent("Ben Cruz ₱3,000.00");
    // Someone who has left the group still shows on old expenses.
    expect(shares).toHaveTextContent("Former member ₱3,000.00");
  });

  it("explains when there are no expenses yet", async () => {
    mockApi(api());
    renderAt(`/groups/${groupId}`);

    expect(await screen.findByText(/No expenses yet/)).toBeInTheDocument();
  });

  it("deletes an expense after confirming", async () => {
    let deleted = false;
    const fetchMock = mockApi(
      api([], {
        [`GET /api/groups/${groupId}/expenses`]: () => ({ status: 200, body: { expenses: deleted ? [] : [hotel] } }),
        [`DELETE /api/groups/${groupId}/expenses/${hotel.id}`]: () => {
          deleted = true;
          return { status: 204 };
        },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Delete Hotel" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(await screen.findByText(/No expenses yet/)).toBeInTheDocument();
    expect(requestsMade(fetchMock)).toContain(`DELETE /api/groups/${groupId}/expenses/${hotel.id}`);
  });
});

describe("adding an expense", () => {
  const created = { status: 201, body: { expense: hotel } };

  it("splits equally between everyone by default, showing each share", async () => {
    const fetchMock = mockApi(api([], { [`POST /api/groups/${groupId}/expenses`]: created }));
    renderAt(`/groups/${groupId}`);

    const user = await fillBasics("Dinner", "100");
    // ₱100 three ways: the first person absorbs the extra centavo, like the server.
    expect(screen.getByText("₱33.34")).toBeInTheDocument();
    expect(screen.getAllByText("₱33.33")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await expect.poll(() => sentExpense(fetchMock)).toEqual({
      description: "Dinner",
      amount: 10_000,
      paidById: ana.id,
      split: { type: "EQUAL", userIds: [ana.id, ben.id, cara.id] },
    });
    expect(await screen.findByLabelText("Description")).toHaveValue("");
  });

  it("lets you choose who paid and who shares", async () => {
    const fetchMock = mockApi(api([], { [`POST /api/groups/${groupId}/expenses`]: created }));
    renderAt(`/groups/${groupId}`);

    const user = await fillBasics("Taxi", "250.50");
    await user.selectOptions(screen.getByLabelText("Paid by"), ben.name);
    await user.click(screen.getByRole("checkbox", { name: "Cara Reyes" }));
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await expect.poll(() => sentExpense(fetchMock)).toMatchObject({
      amount: 25_050,
      paidById: ben.id,
      split: { type: "EQUAL", userIds: [ana.id, ben.id] },
    });
  });

  it("splits by exact amounts, and says what's left to assign", async () => {
    const fetchMock = mockApi(api([], { [`POST /api/groups/${groupId}/expenses`]: created }));
    renderAt(`/groups/${groupId}`);

    const user = await fillBasics("Groceries", "1000");
    await user.click(screen.getByRole("radio", { name: "Exact amounts" }));
    await user.type(screen.getByLabelText("Amount for Ana Santos (₱)"), "700");
    expect(screen.getByText("₱300.00 left to assign")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add expense" }));
    expect(screen.getByText("The amounts must add up to the total")).toBeInTheDocument();
    expect(sentExpense(fetchMock)).toBeUndefined();

    await user.type(screen.getByLabelText("Amount for Ben Cruz (₱)"), "300");
    expect(screen.getByText("All of it is assigned.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await expect.poll(() => sentExpense(fetchMock)).toMatchObject({
      split: {
        type: "EXACT",
        shares: [
          { userId: ana.id, amount: 70_000 },
          { userId: ben.id, amount: 30_000 },
        ],
      },
    });
  });

  it("splits by percentage", async () => {
    const fetchMock = mockApi(api([], { [`POST /api/groups/${groupId}/expenses`]: created }));
    renderAt(`/groups/${groupId}`);

    const user = await fillBasics("Gas", "2400");
    await user.click(screen.getByRole("radio", { name: "Percentages" }));
    await user.type(screen.getByLabelText("Percentage for Ana Santos"), "50");
    await user.type(screen.getByLabelText("Percentage for Ben Cruz"), "25");
    expect(screen.getByText("75% of 100%")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Percentage for Cara Reyes"), "25");
    expect(screen.getByText("Adds up to 100%.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await expect.poll(() => sentExpense(fetchMock)).toMatchObject({
      amount: 240_000,
      split: {
        type: "PERCENTAGE",
        shares: [
          { userId: ana.id, percent: 50 },
          { userId: ben.id, percent: 25 },
          { userId: cara.id, percent: 25 },
        ],
      },
    });
  });

  it("checks the amount before sending", async () => {
    const fetchMock = mockApi(api());
    renderAt(`/groups/${groupId}`);

    const user = await fillBasics("Snacks", "12.345");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    expect(screen.getByLabelText("Amount (₱)")).toHaveAccessibleDescription("Enter an amount like 150 or 150.75");
    expect(requestsMade(fetchMock)).not.toContain(`POST /api/groups/${groupId}/expenses`);
  });

  it("shows the server's explanation when it refuses the expense", async () => {
    mockApi(
      api([], {
        [`POST /api/groups/${groupId}/expenses`]: {
          status: 400,
          body: { error: "NotAGroupMember", message: "Not a member of this group" },
        },
      }),
    );
    renderAt(`/groups/${groupId}`);

    const user = await fillBasics("Dinner", "100");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not a member of this group");
  });
});
