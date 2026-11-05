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
let olive: TestUser;
let groupId: string;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await closeTestContext(ctx);
});

// Ana (an account) runs the "Trip" group; Olive (an account) is an outsider.
beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  ana = await registerUser(ctx.app, "Ana");
  ben = await registerUser(ctx.app, "Ben");
  olive = await registerUser(ctx.app, "Olive");
  groupId = (await as(ctx.app, ana).post("/api/groups", { name: "Trip" })).json().group.id;
});

async function addGuest(name: string, by: TestUser = ana) {
  const response = await as(ctx.app, by).post(`/api/groups/${groupId}/guests`, { name });
  expect(response.statusCode).toBe(201);
  return response.json().member as { id: string; name: string; email: null; isGuest: true };
}

async function balances() {
  const body = (await as(ctx.app, ana).get(`/api/groups/${groupId}/balances`)).json();
  return {
    net: Object.fromEntries(body.balances.map((b: { name: string; net: number }) => [b.name, b.net])),
    transfers: body.transfers as { fromUserId: string; toUserId: string; amount: number }[],
  };
}

const pay = (by: TestUser, payment: { fromUserId?: string; toUserId: string; amount: number }) =>
  as(ctx.app, by).post(`/api/groups/${groupId}/settlements`, payment);

describe("adding guests", () => {
  it("adds someone by name, with no account, straight into the group", async () => {
    const lola = await addGuest("Lola Nena");

    expect(lola).toEqual({ id: expect.any(String), name: "Lola Nena", email: null, isGuest: true });
    const members = (await as(ctx.app, ana).get(`/api/groups/${groupId}`)).json().group.members;
    expect(members).toEqual([
      expect.objectContaining({ id: ana.id, isGuest: false }),
      expect.objectContaining({ id: lola.id, name: "Lola Nena", email: null, isGuest: true }),
    ]);
  });

  it("gives guests no way to log in", async () => {
    const lola = await addGuest("Lola Nena");
    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: lola.id } });

    expect(stored).toMatchObject({ email: null, passwordHash: null, isGuest: true });
    // And the database itself refuses to give a guest credentials.
    await expect(
      ctx.prisma.user.update({ where: { id: lola.id }, data: { email: "lola@example.com", passwordHash: "x" } }),
    ).rejects.toThrow(/users_account_or_guest/);
  });

  it("refuses a name someone in the group already has, ignoring case", async () => {
    await addGuest("Lola Nena");
    const duplicate = await as(ctx.app, ana).post(`/api/groups/${groupId}/guests`, { name: "lola nena" });
    const sameAsAna = await as(ctx.app, ana).post(`/api/groups/${groupId}/guests`, { name: "Ana" });

    for (const response of [duplicate, sameAsAna]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: "NameTaken" });
    }
  });

  it("validates the name and only lets members add guests", async () => {
    expect((await as(ctx.app, ana).post(`/api/groups/${groupId}/guests`, { name: "  " })).statusCode).toBe(400);
    expect((await as(ctx.app, olive).post(`/api/groups/${groupId}/guests`, { name: "Sneaky" })).statusCode).toBe(404);
  });
});

describe("guests in expenses and balances", () => {
  it("can pay for things and share costs, like anyone else", async () => {
    const lola = await addGuest("Lola Nena");
    await as(ctx.app, ana).post(`/api/groups/${groupId}/expenses`, {
      description: "Lechon",
      amount: 600_000,
      paidById: lola.id,
      split: { type: "EQUAL" },
    });

    expect(await balances()).toEqual({
      net: { Ana: -300_000, "Lola Nena": 300_000 },
      transfers: [{ fromUserId: ana.id, toUserId: lola.id, amount: 300_000 }],
    });
  });
});

describe("recording payments involving guests", () => {
  it("lets a member record what a guest paid, even to another guest, until everyone is settled", async () => {
    const ben2 = await addGuest("Ben Guest");
    const cara = await addGuest("Cara Guest");
    // Cara (guest) paid for dinner for herself and Ben (guest).
    await as(ctx.app, ana).post(`/api/groups/${groupId}/expenses`, {
      description: "Dinner",
      amount: 1000,
      paidById: cara.id,
      split: { type: "EQUAL", userIds: [ben2.id, cara.id] },
    });
    expect((await balances()).transfers).toEqual([{ fromUserId: ben2.id, toUserId: cara.id, amount: 500 }]);

    // Ana, the only one with an account, records that Ben paid Cara.
    const response = await pay(ana, { fromUserId: ben2.id, toUserId: cara.id, amount: 500 });

    expect(response.statusCode).toBe(201);
    expect(response.json().settlement).toMatchObject({ fromUserId: ben2.id, toUserId: cara.id, amount: 500 });
    expect((await balances()).transfers).toEqual([]);
  });

  it("never lets anyone record a payment on behalf of someone with an account", async () => {
    await addMember(ctx.app, ana, groupId, ben);
    const response = await pay(ana, { fromUserId: ben.id, toUserId: ana.id, amount: 500 });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "NotYourPayment" });
    expect(await ctx.prisma.settlement.count()).toBe(0);
  });

  it("still records your own payments when no payer is given", async () => {
    const lola = await addGuest("Lola Nena");
    const response = await pay(ana, { toUserId: lola.id, amount: 500 });
    expect(response.json().settlement).toMatchObject({ fromUserId: ana.id, toUserId: lola.id });
  });

  it("refuses a payment from someone to themselves, or from someone outside the group", async () => {
    const lola = await addGuest("Lola Nena");
    const self = await pay(ana, { fromUserId: lola.id, toUserId: lola.id, amount: 500 });
    const outsider = await pay(ana, { fromUserId: olive.id, toUserId: ana.id, amount: 500 });

    expect(self.statusCode).toBe(400);
    expect(outsider.statusCode).toBe(400);
    expect(outsider.json()).toMatchObject({ error: "NotAGroupMember" });
  });
});

describe("removing guests", () => {
  it("removes a settled-up guest but keeps their name on past records", async () => {
    const lola = await addGuest("Lola Nena");
    await as(ctx.app, ana).post(`/api/groups/${groupId}/expenses`, {
      description: "Snacks",
      amount: 1000,
      paidById: lola.id,
      split: { type: "EQUAL" },
    });
    await pay(ana, { toUserId: lola.id, amount: 500 });

    const response = await as(ctx.app, ana).delete(`/api/groups/${groupId}/guests/${lola.id}`);

    expect(response.statusCode).toBe(204);
    const members = (await as(ctx.app, ana).get(`/api/groups/${groupId}`)).json().group.members;
    expect(members.map((m: { id: string }) => m.id)).toEqual([ana.id]);
    const [expense] = (await as(ctx.app, ana).get(`/api/groups/${groupId}/expenses`)).json().expenses;
    expect(expense.paidBy).toEqual({ id: lola.id, name: "Lola Nena" });
  });

  it("refuses while the guest still owes or is owed money", async () => {
    const lola = await addGuest("Lola Nena");
    await as(ctx.app, ana).post(`/api/groups/${groupId}/expenses`, {
      description: "Snacks",
      amount: 1000,
      split: { type: "EQUAL" },
    });

    const response = await as(ctx.app, ana).delete(`/api/groups/${groupId}/guests/${lola.id}`);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "BalanceNotSettled" });
  });

  it("only removes guests, never people with accounts", async () => {
    await addMember(ctx.app, ana, groupId, ben);
    const response = await as(ctx.app, ana).delete(`/api/groups/${groupId}/guests/${ben.id}`);
    expect(response.statusCode).toBe(404);
  });
});

describe("when the last person with an account leaves", () => {
  it("closes the group and removes its guests", async () => {
    const lola = await addGuest("Lola Nena");

    expect((await as(ctx.app, ana).post(`/api/groups/${groupId}/leave`, {})).statusCode).toBe(204);

    expect(await ctx.prisma.group.count()).toBe(0);
    expect(await ctx.prisma.user.count({ where: { id: lola.id } })).toBe(0);
  });
});
