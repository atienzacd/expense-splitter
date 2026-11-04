import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember,
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

beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  ana = await registerUser(ctx.app, "Ana");
  ben = await registerUser(ctx.app, "Ben");
  cara = await registerUser(ctx.app, "Cara");
  outsider = await registerUser(ctx.app, "Olive");

  groupId = (await as(ctx.app, ana).post("/api/groups", { name: "Barkada" })).json().group.id;
  for (const user of [ben, cara]) {
    await addMember(ctx.app, ana, groupId, user);
  }
});

async function addExpense(payer: TestUser, amount: number) {
  const response = await as(ctx.app, payer).post(`/api/groups/${groupId}/expenses`, {
    description: "Shared",
    amount,
    split: { type: "EQUAL" },
  });
  expect(response.statusCode).toBe(201);
}

async function balances(user = ana) {
  const response = await as(ctx.app, user).get(`/api/groups/${groupId}/balances`);
  expect(response.statusCode).toBe(200);
  const body = response.json();
  return {
    net: Object.fromEntries(body.balances.map((b: { name: string; net: number }) => [b.name, b.net])),
    transfers: body.transfers as { fromUserId: string; toUserId: string; amount: number }[],
  };
}

describe("balances", () => {
  it("lists every member at zero for a new group", async () => {
    expect(await balances()).toEqual({ net: { Ana: 0, Ben: 0, Cara: 0 }, transfers: [] });
  });

  it("works out who owes whom and the fewest payments", async () => {
    // Ana pays ₱30 dinner, Ben pays ₱6 drinks; both split three ways.
    await addExpense(ana, 3000);
    await addExpense(ben, 600);

    const { net, transfers } = await balances();
    expect(net).toEqual({ Ana: 1800, Ben: -600, Cara: -1200 });
    expect(transfers).toEqual([
      { fromUserId: cara.id, toUserId: ana.id, amount: 1200 },
      { fromUserId: ben.id, toUserId: ana.id, amount: 600 },
    ]);
  });

  it("is hidden from non-members", async () => {
    const response = await as(ctx.app, outsider).get(`/api/groups/${groupId}/balances`);
    expect(response.statusCode).toBe(404);
  });
});

describe("settlements", () => {
  beforeEach(async () => {
    await addExpense(ana, 3000);
    await addExpense(ben, 600);
  });

  it("recording the suggested payments settles everyone", async () => {
    for (const { fromUserId, toUserId, amount } of (await balances()).transfers) {
      const payer = [ben, cara].find((u) => u.id === fromUserId)!;
      const response = await as(ctx.app, payer).post(`/api/groups/${groupId}/settlements`, { toUserId, amount });
      expect(response.statusCode).toBe(201);
      expect(response.json().settlement).toMatchObject({ fromUserId, toUserId, amount });
    }

    expect(await balances()).toEqual({ net: { Ana: 0, Ben: 0, Cara: 0 }, transfers: [] });
  });

  it("a partial payment reduces what is owed", async () => {
    await as(ctx.app, cara).post(`/api/groups/${groupId}/settlements`, { toUserId: ana.id, amount: 1000 });

    const { net } = await balances();
    expect(net).toEqual({ Ana: 800, Ben: -600, Cara: -200 });
  });

  it("lists settlements newest first", async () => {
    await as(ctx.app, cara).post(`/api/groups/${groupId}/settlements`, { toUserId: ana.id, amount: 100 });
    await as(ctx.app, ben).post(`/api/groups/${groupId}/settlements`, { toUserId: ana.id, amount: 200 });

    const response = await as(ctx.app, ana).get(`/api/groups/${groupId}/settlements`);
    expect(response.json().settlements.map((s: { amount: number }) => s.amount)).toEqual([200, 100]);
  });

  it("rejects paying yourself or someone outside the group", async () => {
    const self = await as(ctx.app, ana).post(`/api/groups/${groupId}/settlements`, { toUserId: ana.id, amount: 100 });
    const stranger = await as(ctx.app, ana).post(`/api/groups/${groupId}/settlements`, {
      toUserId: outsider.id,
      amount: 100,
    });

    expect(self.statusCode).toBe(400);
    expect(self.json()).toMatchObject({ error: "InvalidSettlement" });
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json()).toMatchObject({ error: "NotAGroupMember" });
  });

  it("does not let outsiders record payments", async () => {
    const response = await as(ctx.app, outsider).post(`/api/groups/${groupId}/settlements`, {
      toUserId: ana.id,
      amount: 100,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("isolation between groups", () => {
  it("balances only count the group's own expenses", async () => {
    const otherGroupId = (await as(ctx.app, ana).post("/api/groups", { name: "Other" })).json().group.id;
    await addMember(ctx.app, ana, otherGroupId, ben);
    await as(ctx.app, ana).post(`/api/groups/${otherGroupId}/expenses`, {
      description: "Elsewhere",
      amount: 5000,
      split: { type: "EQUAL" },
    });

    expect(await balances()).toEqual({ net: { Ana: 0, Ben: 0, Cara: 0 }, transfers: [] });
  });

  it("hides settlements and blocks expense deletion for outsiders", async () => {
    await addExpense(ana, 300);
    const expenseId = (await as(ctx.app, ana).get(`/api/groups/${groupId}/expenses`)).json().expenses[0].id;

    expect((await as(ctx.app, outsider).get(`/api/groups/${groupId}/settlements`)).statusCode).toBe(404);
    expect((await as(ctx.app, outsider).delete(`/api/groups/${groupId}/expenses/${expenseId}`)).statusCode).toBe(404);
    expect(await ctx.prisma.expense.count()).toBe(1);
  });
});
