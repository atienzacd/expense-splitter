import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/lib/limits.ts";
import { cleanUpExpiredData } from "../../src/maintenance.ts";
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

beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  ana = await registerUser(ctx.app, "Ana");
  ben = await registerUser(ctx.app, "Ben");
  groupId = (await as(ctx.app, ana).post("/api/groups", { name: "Trip" })).json().group.id;
});

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

describe("invitations expire after a week", () => {
  async function inviteBen() {
    expect((await as(ctx.app, ana).post(`/api/groups/${groupId}/invitations`, { email: ben.email })).statusCode).toBe(202);
    return ctx.prisma.invitation.findFirstOrThrow({ where: { email: ben.email } });
  }

  it("says when each invitation expires", async () => {
    const invitation = await inviteBen();
    const expected = new Date(invitation.createdAt.getTime() + 7 * DAY_MS).toISOString();

    const [mine] = (await as(ctx.app, ben).get("/api/invitations")).json().invitations;
    const [pending] = (await as(ctx.app, ana).get(`/api/groups/${groupId}/invitations`)).json().invitations;
    expect(mine.expiresAt).toBe(expected);
    expect(pending.expiresAt).toBe(expected);
  });

  it("hides an expired invitation and refuses to accept it", async () => {
    const invitation = await inviteBen();
    await ctx.prisma.invitation.update({ where: { id: invitation.id }, data: { createdAt: daysAgo(8) } });

    expect((await as(ctx.app, ben).get("/api/invitations")).json().invitations).toEqual([]);
    expect((await as(ctx.app, ana).get(`/api/groups/${groupId}/invitations`)).json().invitations).toEqual([]);
    const accept = await as(ctx.app, ben).post(`/api/invitations/${invitation.id}/accept`, {});
    expect(accept.statusCode).toBe(404);
    expect(await ctx.prisma.groupMember.count({ where: { groupId } })).toBe(1);
  });

  it("starts a fresh week when the same person is invited again", async () => {
    const invitation = await inviteBen();
    await ctx.prisma.invitation.update({ where: { id: invitation.id }, data: { createdAt: daysAgo(8) } });

    const renewed = await inviteBen();
    expect(renewed.id).toBe(invitation.id);
    expect(renewed.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await as(ctx.app, ben).post(`/api/invitations/${invitation.id}/accept`, {})).statusCode).toBe(200);
  });
});

describe("changes to a group happen one at a time", () => {
  it("makes leaving wait for an expense being added at the same moment", async () => {
    await addMember(ctx.app, ana, groupId, ben);
    let leave: ReturnType<ReturnType<typeof as>["post"]> | undefined;

    // Hold the group's lock (as adding an expense does), ask to leave meanwhile,
    // then add an expense Ben shares before letting go.
    await ctx.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "groups" WHERE "id" = ${groupId}::uuid FOR UPDATE`;
      leave = as(ctx.app, ben).post(`/api/groups/${groupId}/leave`, {});
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.expense.create({
        data: {
          groupId,
          paidById: ana.id,
          description: "Taxi",
          amount: 1000,
          splitType: "EQUAL",
          splits: { create: [{ userId: ana.id, amountOwed: 500 }, { userId: ben.id, amountOwed: 500 }] },
        },
      });
    });

    // Leaving only went ahead after the expense was in, so it saw Ben's debt.
    const response = await leave!;
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "BalanceNotSettled" });
    expect(await ctx.prisma.groupMember.count({ where: { groupId, userId: ben.id } })).toBe(1);
  });
});

describe("limits", () => {
  it(`allows at most ${LIMITS.membersPerGroup} people in a group`, async () => {
    const guests = Array.from({ length: LIMITS.membersPerGroup - 1 }, (_, i) => ({ name: `Guest ${i}`, isGuest: true }));
    for (const guest of guests) {
      await ctx.prisma.user.create({ data: { ...guest, memberships: { create: { groupId } } } });
    }

    const tooMany = await as(ctx.app, ana).post(`/api/groups/${groupId}/guests`, { name: "One more" });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json()).toMatchObject({ error: "LimitReached" });

    // Joining by invitation is refused too, and the invitation is kept.
    await as(ctx.app, ana).post(`/api/groups/${groupId}/invitations`, { email: ben.email });
    const [invitation] = (await as(ctx.app, ben).get("/api/invitations")).json().invitations;
    const join = await as(ctx.app, ben).post(`/api/invitations/${invitation.id}/accept`, {});
    expect(join.statusCode).toBe(409);
    expect(await ctx.prisma.invitation.count()).toBe(1);
  });

  it(`allows at most ${LIMITS.expensesPerGroup} expenses and ${LIMITS.paymentsPerGroup} payments in a group`, async () => {
    await ctx.prisma.expense.createMany({
      data: Array.from({ length: LIMITS.expensesPerGroup }, () => ({
        groupId,
        paidById: ana.id,
        description: "Old",
        amount: 1,
        splitType: "EQUAL" as const,
      })),
    });
    const guest = (await as(ctx.app, ana).post(`/api/groups/${groupId}/guests`, { name: "Lola" })).json().member;
    await ctx.prisma.settlement.createMany({
      data: Array.from({ length: LIMITS.paymentsPerGroup }, () => ({
        groupId,
        fromUserId: ana.id,
        toUserId: guest.id,
        amount: 1,
      })),
    });

    const expense = await as(ctx.app, ana).post(`/api/groups/${groupId}/expenses`, {
      description: "One more",
      amount: 100,
      split: { type: "EQUAL" },
    });
    const payment = await as(ctx.app, ana).post(`/api/groups/${groupId}/settlements`, { toUserId: guest.id, amount: 100 });
    for (const response of [expense, payment]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: "LimitReached" });
    }
  });

  it(`allows at most ${LIMITS.pendingInvitationsPerGroup} invitations waiting in a group`, async () => {
    await ctx.prisma.invitation.createMany({
      data: Array.from({ length: LIMITS.pendingInvitationsPerGroup }, (_, i) => ({
        groupId,
        email: `friend${i}@example.com`,
        invitedById: ana.id,
      })),
    });

    const tooMany = await as(ctx.app, ana).post(`/api/groups/${groupId}/invitations`, { email: ben.email });
    expect(tooMany.statusCode).toBe(409);
    // Inviting someone already waiting again is fine: it only renews their invitation.
    const again = await as(ctx.app, ana).post(`/api/groups/${groupId}/invitations`, { email: "friend0@example.com" });
    expect(again.statusCode).toBe(202);
  });

  it(`lets one person be in at most ${LIMITS.groupsPerUser} groups`, async () => {
    for (let i = 1; i < LIMITS.groupsPerUser; i++) {
      await ctx.prisma.group.create({
        data: { name: `Group ${i}`, createdById: ana.id, members: { create: { userId: ana.id } } },
      });
    }
    const tooMany = await as(ctx.app, ana).post("/api/groups", { name: "One more" });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json()).toMatchObject({ error: "LimitReached" });
  });
});

describe("cleaning up expired data", () => {
  it("removes old sessions, expired invitations and guests nothing refers to", async () => {
    // A session that expired two days ago, and Ana's current one.
    await ctx.prisma.session.updateMany({ where: { userId: ben.id }, data: { expiresAt: daysAgo(2) } });
    // An expired invitation, and a fresh one.
    await ctx.prisma.invitation.createMany({
      data: [
        { groupId, email: "old@example.com", invitedById: ana.id, createdAt: daysAgo(8) },
        { groupId, email: "new@example.com", invitedById: ana.id },
      ],
    });
    // Lola was removed after settling up, but her expense keeps her; Tito was
    // removed with nothing left; Cara is still a member.
    const add = async (name: string) =>
      (await as(ctx.app, ana).post(`/api/groups/${groupId}/guests`, { name })).json().member.id as string;
    const [lola, tito, cara] = [await add("Lola"), await add("Tito"), await add("Cara")];
    await as(ctx.app, ana).post(`/api/groups/${groupId}/expenses`, {
      description: "Snacks",
      amount: 1000,
      paidById: lola,
      split: { type: "EXACT", shares: [{ userId: lola, amount: 1000 }] },
    });
    for (const guest of [lola, tito]) {
      expect((await as(ctx.app, ana).delete(`/api/groups/${groupId}/guests/${guest}`)).statusCode).toBe(204);
    }

    expect(await cleanUpExpiredData(ctx.prisma)).toEqual({ sessions: 1, invitations: 1, guests: 1 });

    expect(await ctx.prisma.session.count({ where: { userId: ana.id } })).toBe(1);
    expect((await ctx.prisma.invitation.findMany()).map((i) => i.email)).toEqual(["new@example.com"]);
    const left = (await ctx.prisma.user.findMany({ where: { isGuest: true } })).map((u) => u.id).sort();
    expect(left).toEqual([lola, cara].sort());
  });
});
