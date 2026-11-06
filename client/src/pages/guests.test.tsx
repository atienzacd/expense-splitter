import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Member } from "../api/groups.ts";
import { ana, loggedInAs, mockApi, renderAt } from "../test/render.tsx";

const groupId = "0196f3a0-0000-7000-8000-0000000000a1";
const joined = "2026-11-04T00:00:00.000Z";
const lola = { id: "0196f3a0-0000-7000-8000-000000000011", name: "Lola Nena", email: null, isGuest: true };
const tito = { id: "0196f3a0-0000-7000-8000-000000000012", name: "Tito Boy", email: null, isGuest: true };

const group = {
  id: groupId,
  name: "Family reunion",
  createdAt: joined,
  createdById: ana.id,
  currency: "PHP",
  members: [{ ...ana, isGuest: false }, lola, tito].map((m) => ({ ...m, joinedAt: joined })),
};

// Lola paid for everything; Tito and Ana each owe her.
const balances = {
  balances: [
    { userId: ana.id, name: ana.name, isGuest: false, net: -10_000 },
    { userId: lola.id, name: lola.name, isGuest: true, net: 30_000 },
    { userId: tito.id, name: tito.name, isGuest: true, net: -20_000 },
  ],
  transfers: [
    { fromUserId: tito.id, toUserId: lola.id, amount: 20_000 },
    { fromUserId: ana.id, toUserId: lola.id, amount: 10_000 },
  ],
};

function api(extra = {}) {
  return {
    ...loggedInAs(ana),
    [`GET /api/groups/${groupId}`]: { status: 200, body: { group } },
    [`GET /api/groups/${groupId}/invitations`]: { status: 200, body: { invitations: [] } },
    [`GET /api/groups/${groupId}/expenses`]: { status: 200, body: { expenses: [] } },
    [`GET /api/groups/${groupId}/balances`]: { status: 200, body: balances },
    [`GET /api/groups/${groupId}/settlements`]: { status: 200, body: { settlements: [] } },
    ...extra,
  };
}

function bodyOf(fetchMock: ReturnType<typeof mockApi>, method: string, url: string) {
  const [, init] = fetchMock.mock.calls.find(([u, req]) => u === url && req?.method === method)!;
  return init?.body ? JSON.parse(init.body as string) : undefined;
}

describe("guests in the member list", () => {
  it("marks guests and lets members remove them", async () => {
    const fetchMock = mockApi(api({ [`DELETE /api/groups/${groupId}/guests/${lola.id}`]: { status: 204 } }));
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    const members = await screen.findByRole("region", { name: "Members (3)" });
    expect(within(members).getAllByText("Guest")).toHaveLength(2);
    expect(within(members).getByText("ana@example.com")).toBeInTheDocument();

    await user.click(within(members).getByRole("button", { name: "Remove Lola Nena" }));
    await expect.poll(() => fetchMock.mock.calls.some(([u, r]) => u === `/api/groups/${groupId}/guests/${lola.id}` && r?.method === "DELETE")).toBe(true);
  });

  it("explains why a guest who still owes money can't be removed", async () => {
    mockApi(
      api({
        [`DELETE /api/groups/${groupId}/guests/${tito.id}`]: {
          status: 409,
          body: { error: "BalanceNotSettled", message: "They still owe money in this group" },
        },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Remove Tito Boy" }));
    expect(await screen.findByText("They still owe money in this group")).toBeInTheDocument();
  });
});

describe("adding a guest", () => {
  it("adds someone by name", async () => {
    const fetchMock = mockApi(
      api({
        [`POST /api/groups/${groupId}/guests`]: {
          status: 201,
          body: { member: { id: "g3", name: "Ate Joy", email: null, isGuest: true } },
        },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Their name"), "  Ate Joy ");
    await user.click(screen.getByRole("button", { name: "Add to group" }));

    expect(await screen.findByText("Ate Joy was added to the group.")).toBeInTheDocument();
    expect(bodyOf(fetchMock, "POST", `/api/groups/${groupId}/guests`)).toEqual({ name: "Ate Joy" });
  });

  it("checks the name and shows when it's already taken", async () => {
    mockApi(
      api({
        [`POST /api/groups/${groupId}/guests`]: {
          status: 409,
          body: { error: "NameTaken", message: "Someone in this group already has that name" },
        },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add to group" }));
    expect(screen.getByText("Enter their name")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Their name"), "Lola Nena");
    await user.click(screen.getByRole("button", { name: "Add to group" }));
    expect(await screen.findByText("Someone in this group already has that name")).toBeInTheDocument();
  });
});

describe("recording guests' payments", () => {
  it("lets you mark a guest's payment as paid, even to another guest", async () => {
    const fetchMock = mockApi(
      api({ [`POST /api/groups/${groupId}/settlements`]: { status: 201, body: { settlement: { id: "s1" } } } }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    const payments = await screen.findByRole("region", { name: "Who pays whom" });
    const titoRow = (await within(payments).findByText("Tito Boy pays Lola Nena ₱200.00")).closest("li")!;
    // Both rows can be recorded: yours, and the guest's.
    expect(within(payments).getAllByRole("button", { name: "Mark as paid" })).toHaveLength(2);

    await user.click(within(titoRow).getByRole("button", { name: "Mark as paid" }));
    expect(within(titoRow).getByText(/Record that Tito Boy paid Lola Nena ₱200.00\?/)).toBeInTheDocument();
    await user.click(within(titoRow).getByRole("button", { name: "Yes, it's paid" }));

    await expect
      .poll(() => fetchMock.mock.calls.some(([u, r]) => u === `/api/groups/${groupId}/settlements` && r?.method === "POST"))
      .toBe(true);
    expect(bodyOf(fetchMock, "POST", `/api/groups/${groupId}/settlements`)).toEqual({
      fromUserId: tito.id,
      toUserId: lola.id,
      amount: 20_000,
    });
  });

  it("records a different payment made by a guest", async () => {
    const fetchMock = mockApi(
      api({ [`POST /api/groups/${groupId}/settlements`]: { status: 201, body: { settlement: { id: "s1" } } } }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByText("Record a different payment"));
    await user.selectOptions(screen.getByLabelText("Who paid"), "Tito Boy (guest)");
    await user.selectOptions(screen.getByLabelText("Paid to"), "Ana Santos (you)");
    await user.type(screen.getByLabelText("Amount paid (₱)"), "50");
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(await screen.findByText("Recorded that Tito Boy paid you ₱50.00.")).toBeInTheDocument();
    expect(bodyOf(fetchMock, "POST", `/api/groups/${groupId}/settlements`)).toEqual({
      fromUserId: tito.id,
      toUserId: ana.id,
      amount: 5_000,
    });
  });
});

describe("the expense form after adding someone", () => {
  it("includes the new person in the split", async () => {
    let members: Member[] = [{ ...ana, isGuest: false, joinedAt: joined }];
    mockApi(
      api({
        [`GET /api/groups/${groupId}`]: () => ({ status: 200, body: { group: { ...group, members } } }),
        [`POST /api/groups/${groupId}/guests`]: () => {
          members = [...members, { ...lola, joinedAt: joined }];
          return { status: 201, body: { member: lola } };
        },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Their name"), "Lola Nena");
    await user.click(screen.getByRole("button", { name: "Add to group" }));

    expect(await screen.findByRole("checkbox", { name: "Lola Nena" })).toBeChecked();
    expect(screen.getByLabelText("Paid by")).toHaveTextContent("Lola Nena");
  });
});

describe("when a group is full", () => {
  it("shows the server's explanation", async () => {
    mockApi(
      api({
        [`POST /api/groups/${groupId}/guests`]: {
          status: 409,
          body: { error: "LimitReached", message: "A group can have at most 50 people." },
        },
      }),
    );
    renderAt(`/groups/${groupId}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Their name"), "Ate Joy");
    await user.click(screen.getByRole("button", { name: "Add to group" }));
    expect(await screen.findByText("A group can have at most 50 people.")).toBeInTheDocument();
  });
});
