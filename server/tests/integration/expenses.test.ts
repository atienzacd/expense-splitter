import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  as,
  closeTestContext,
  createTestContext,
  registerUser,
  resetDatabase,
  type TestContext,
  type TestUser,
} from "./helpers.ts";

let ctx: TestContext;
let ana: TestUser;
let ben: TestUser;
let cara: TestUser;
let outsider: TestUser;
let groupId: string;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await closeTestContext(ctx);
});

// Ana, Ben and Cara share a group; Olive is not in it.
beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  ana = await registerUser(ctx.app, "Ana");
  ben = await registerUser(ctx.app, "Ben");
  cara = await registerUser(ctx.app, "Cara");
  outsider = await registerUser(ctx.app, "Olive");

  groupId = (await as(ctx.app, ana).post("/groups", { name: "Barkada" })).json().group.id;
  for (const user of [ben, cara]) {
    await as(ctx.app, ana).post(`/groups/${groupId}/members`, { email: user.email });
  }
});

const owed = (expense: { splits: { userId: string; amountOwed: number }[] }) =>
  Object.fromEntries(expense.splits.map((s) => [s.userId, s.amountOwed]));

describe("adding expenses", () => {
  it("splits equally between everyone by default", async () => {
    const response = await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
      description: "Dinner",
      amount: 10_000,
      split: { type: "EQUAL" },
    });

    expect(response.statusCode).toBe(201);
    const { expense } = response.json();
    expect(expense).toMatchObject({ description: "Dinner", amount: 10_000, splitType: "EQUAL", paidBy: { id: ana.id } });
    // ₱100 three ways: the extra centavo goes to the first member.
    expect(owed(expense)).toEqual({ [ana.id]: 3334, [ben.id]: 3333, [cara.id]: 3333 });
  });

  it("splits equally between chosen people, paid by someone else", async () => {
    const response = await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
      description: "Taxi",
      amount: 500,
      paidById: ben.id,
      split: { type: "EQUAL", userIds: [ben.id, cara.id] },
    });

    const { expense } = response.json();
    expect(expense.paidBy.id).toBe(ben.id);
    expect(owed(expense)).toEqual({ [ben.id]: 250, [cara.id]: 250 });
  });

  it("supports exact amounts", async () => {
    const response = await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
      description: "Groceries",
      amount: 1000,
      split: {
        type: "EXACT",
        shares: [
          { userId: ana.id, amount: 700 },
          { userId: ben.id, amount: 300 },
        ],
      },
    });
    expect(owed(response.json().expense)).toEqual({ [ana.id]: 700, [ben.id]: 300 });
  });

  it("supports percentages", async () => {
    const response = await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
      description: "Rent",
      amount: 10_001,
      split: {
        type: "PERCENTAGE",
        shares: [
          { userId: ana.id, percent: 50 },
          { userId: ben.id, percent: 30 },
          { userId: cara.id, percent: 20 },
        ],
      },
    });
    expect(owed(response.json().expense)).toEqual({ [ana.id]: 5001, [ben.id]: 3000, [cara.id]: 2000 });
  });

  it("rejects amounts that don't add up", async () => {
    const response = await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
      description: "Groceries",
      amount: 1000,
      split: { type: "EXACT", shares: [{ userId: ana.id, amount: 999 }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "SplitError" });
  });

  it("rejects a payer or participant outside the group", async () => {
    const outsiderPays = await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
      description: "Snacks",
      amount: 300,
      paidById: outsider.id,
      split: { type: "EQUAL" },
    });
    const outsiderOwes = await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
      description: "Snacks",
      amount: 300,
      split: { type: "EQUAL", userIds: [ana.id, outsider.id] },
    });

    for (const response of [outsiderPays, outsiderOwes]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "NotAGroupMember" });
    }
    expect(await ctx.prisma.expense.count()).toBe(0);
  });

  it.each([0, -100, 10.5, "100"])("rejects an invalid amount (%s)", async (amount) => {
    const response = await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
      description: "Bad",
      amount,
      split: { type: "EQUAL" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("does not let outsiders add expenses", async () => {
    const response = await as(ctx.app, outsider).post(`/groups/${groupId}/expenses`, {
      description: "Sneaky",
      amount: 100,
      split: { type: "EQUAL" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("listing and deleting expenses", () => {
  it("lists newest first, for members only", async () => {
    for (const description of ["First", "Second"]) {
      await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, { description, amount: 300, split: { type: "EQUAL" } });
    }

    const response = await as(ctx.app, ben).get(`/groups/${groupId}/expenses`);
    expect(response.json().expenses.map((e: { description: string }) => e.description)).toEqual(["Second", "First"]);
    expect((await as(ctx.app, outsider).get(`/groups/${groupId}/expenses`)).statusCode).toBe(404);
  });

  it("deletes an expense and its splits", async () => {
    const created = await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
      description: "Oops",
      amount: 300,
      split: { type: "EQUAL" },
    });
    const { id } = created.json().expense;

    const response = await as(ctx.app, ben).delete(`/groups/${groupId}/expenses/${id}`);
    expect(response.statusCode).toBe(204);
    expect(await ctx.prisma.expenseSplit.count()).toBe(0);
    expect((await as(ctx.app, ben).delete(`/groups/${groupId}/expenses/${id}`)).statusCode).toBe(404);
  });

  it("can't delete another group's expense through your own group", async () => {
    const otherGroupId = (await as(ctx.app, outsider).post("/groups", { name: "Other" })).json().group.id;
    const theirs = await as(ctx.app, outsider).post(`/groups/${otherGroupId}/expenses`, {
      description: "Theirs",
      amount: 100,
      split: { type: "EQUAL" },
    });

    const response = await as(ctx.app, ana).delete(`/groups/${groupId}/expenses/${theirs.json().expense.id}`);
    expect(response.statusCode).toBe(404);
    expect(await ctx.prisma.expense.count()).toBe(1);
  });
});
