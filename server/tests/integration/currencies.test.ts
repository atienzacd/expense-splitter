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
let groupId: string;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await closeTestContext(ctx);
});

// Ana and Ben share a "Japan trip" group that keeps its books in pesos.
beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  ana = await registerUser(ctx.app, "Ana");
  ben = await registerUser(ctx.app, "Ben");
  groupId = (await as(ctx.app, ana).post("/api/groups", { name: "Japan trip" })).json().group.id;
  await addMember(ctx.app, ana, groupId, ben);
});

const addExpense = (payload: object, by: TestUser = ana) =>
  as(ctx.app, by).post(`/api/groups/${groupId}/expenses`, { description: "Ramen", ...payload });

const owed = (expense: { splits: { userId: string; amountOwed: number }[] }) =>
  Object.fromEntries(expense.splits.map((s) => [s.userId, s.amountOwed]));

describe("group currency", () => {
  it("defaults to pesos and can be chosen when creating a group", async () => {
    const usd = await as(ctx.app, ana).post("/api/groups", { name: "New York", currency: "USD" });
    expect(usd.statusCode).toBe(201);
    expect(usd.json().group).toMatchObject({ name: "New York", currency: "USD" });

    const detail = (await as(ctx.app, ana).get(`/api/groups/${groupId}`)).json().group;
    expect(detail.currency).toBe("PHP");
    const list = (await as(ctx.app, ana).get("/api/groups")).json().groups;
    expect(list.map((g: { currency: string }) => g.currency).sort()).toEqual(["PHP", "USD"]);
  });

  it("refuses unsupported currencies", async () => {
    const response = await as(ctx.app, ana).post("/api/groups", { name: "Mars", currency: "XYZ" });
    expect(response.statusCode).toBe(400);
  });
});

describe("expenses paid in another currency", () => {
  it("converts to the group's currency and keeps what was actually paid", async () => {
    const response = await addExpense({ amount: 3000, currency: "JPY", exchangeRate: "0.39756", split: { type: "EQUAL" } });

    expect(response.statusCode).toBe(201);
    const { expense } = response.json();
    // ¥3,000 × 0.39756 = ₱1,192.68, split ₱596.34 each.
    expect(expense).toMatchObject({
      amount: 119_268,
      original: { currency: "JPY", amount: 3000, exchangeRate: "0.39756" },
    });
    expect(owed(expense)).toEqual({ [ana.id]: 59_634, [ben.id]: 59_634 });

    const balances = (await as(ctx.app, ben).get(`/api/groups/${groupId}/balances`)).json();
    expect(balances.transfers).toEqual([{ fromUserId: ben.id, toUserId: ana.id, amount: 59_634 }]);

    const [listed] = (await as(ctx.app, ben).get(`/api/groups/${groupId}/expenses`)).json().expenses;
    expect(listed.original).toEqual({ currency: "JPY", amount: 3000, exchangeRate: "0.39756" });
  });

  it("shares exact amounts typed in the paid currency in the same proportion", async () => {
    const response = await addExpense({
      amount: 1000,
      currency: "JPY",
      exchangeRate: "0.39756",
      split: {
        type: "EXACT",
        shares: [
          { userId: ana.id, amount: 700 },
          { userId: ben.id, amount: 300 },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const { expense } = response.json();
    expect(expense.amount).toBe(39_756);
    expect(owed(expense)).toEqual({ [ana.id]: 27_829, [ben.id]: 11_927 });
  });

  it("checks exact amounts against what was paid, not the converted total", async () => {
    const response = await addExpense({
      amount: 1000,
      currency: "JPY",
      exchangeRate: "0.39756",
      split: { type: "EXACT", shares: [{ userId: ana.id, amount: 39_756 }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "SplitError" });
  });

  it("needs a rate for another currency", async () => {
    const response = await addExpense({ amount: 3000, currency: "JPY", split: { type: "EQUAL" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "ExchangeRateRequired" });
  });

  it("refuses amounts that convert to nothing, and bad rates", async () => {
    const tiny = await addExpense({ amount: 1, currency: "JPY", exchangeRate: "0.001", split: { type: "EQUAL" } });
    expect(tiny.statusCode).toBe(400);
    expect(tiny.json()).toMatchObject({ error: "InvalidConversion" });

    for (const exchangeRate of ["0", "-1", "1e3", "abc"]) {
      const bad = await addExpense({ amount: 3000, currency: "JPY", exchangeRate, split: { type: "EQUAL" } });
      expect(bad.statusCode).toBe(400);
    }
    expect(await ctx.prisma.expense.count()).toBe(0);
  });

  it("stores nothing extra for expenses in the group's own currency", async () => {
    const response = await addExpense({ amount: 10_000, currency: "PHP", exchangeRate: "2", split: { type: "EQUAL" } });
    expect(response.json().expense).toMatchObject({ amount: 10_000, original: null });
  });

  it("can't be given half the original details, even directly in the database", async () => {
    const { expense } = (await addExpense({ amount: 10_000, split: { type: "EQUAL" } })).json();
    await expect(
      ctx.prisma.expense.update({ where: { id: expense.id }, data: { originalCurrency: "JPY" } }),
    ).rejects.toThrow(/expenses_original_complete/);
  });
});

describe("GET /api/rates", () => {
  it("suggests today's rate", async () => {
    const response = await as(ctx.app, ana).get("/api/rates?from=JPY&to=PHP");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ from: "JPY", to: "PHP", rate: "0.39756", date: "2026-11-05" });
  });

  it("says so when no rate is available", async () => {
    const response = await as(ctx.app, ana).get("/api/rates?from=EUR&to=PHP");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "RatesUnavailable" });
  });

  it("validates the currencies and needs a login", async () => {
    expect((await as(ctx.app, ana).get("/api/rates?from=XYZ&to=PHP")).statusCode).toBe(400);
    expect((await as(ctx.app, ana).get("/api/rates?from=JPY")).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "GET", url: "/api/rates?from=JPY&to=PHP" })).statusCode).toBe(401);
  });
});
