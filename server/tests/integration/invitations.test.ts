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

// Ana owns the "Trip" group; Ben and Olive aren't in it.
beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  ana = await registerUser(ctx.app, "Ana");
  ben = await registerUser(ctx.app, "Ben");
  olive = await registerUser(ctx.app, "Olive");
  groupId = (await as(ctx.app, ana).post("/api/groups", { name: "Trip" })).json().group.id;
});

const invite = (from: TestUser, email: string, group = groupId) =>
  as(ctx.app, from).post(`/api/groups/${group}/invitations`, { email });

async function myInvitations(user: TestUser) {
  const response = await as(ctx.app, user).get("/api/invitations");
  expect(response.statusCode).toBe(200);
  return response.json().invitations as { id: string; group: { id: string; name: string }; invitedBy: { name: string } }[];
}

const memberIds = async () =>
  ((await as(ctx.app, ana).get(`/api/groups/${groupId}`)).json().group.members as { id: string }[]).map((m) => m.id);

describe("inviting", () => {
  it("gives the same answer whether or not the email has an account", async () => {
    const registered = await invite(ana, ben.email);
    const unregistered = await invite(ana, "not-signed-up-yet@example.com");

    expect(registered.statusCode).toBe(202);
    expect(unregistered.statusCode).toBe(202);
    expect(registered.json()).toEqual(unregistered.json());
  });

  it("doesn't add anyone until they accept", async () => {
    await invite(ana, ben.email);
    expect(await memberIds()).toEqual([ana.id]);
  });

  it("shows the invitation to the invited person, with the group and who invited them", async () => {
    await invite(ana, "BEN@example.com");

    expect(await myInvitations(ben)).toEqual([
      expect.objectContaining({ group: { id: groupId, name: "Trip" }, invitedBy: { id: ana.id, name: "Ana" } }),
    ]);
    expect(await myInvitations(olive)).toEqual([]);
  });

  it("is waiting for people who sign up later", async () => {
    await invite(ana, "carla@example.com");
    const carla = await registerUser(ctx.app, "Carla");

    expect(await myInvitations(carla)).toHaveLength(1);
  });

  it("keeps one invitation when the same person is invited twice", async () => {
    await invite(ana, ben.email);
    expect((await invite(ana, ben.email)).statusCode).toBe(202);
    expect(await myInvitations(ben)).toHaveLength(1);
  });

  it("says when the person is already a member", async () => {
    await addMember(ctx.app, ana, groupId, ben);
    const response = await invite(ana, ben.email);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "AlreadyAMember" });
  });

  it("is only possible for members", async () => {
    expect((await invite(olive, olive.email)).statusCode).toBe(404);
  });

  it("validates the email", async () => {
    expect((await invite(ana, "not-an-email")).statusCode).toBe(400);
  });

  it("is rate limited", async () => {
    const limited = await createTestContext({ authRateLimit: { max: 2, timeWindow: "1 minute" } });
    try {
      const owner = await registerUser(limited.app, "Owner");
      const id = (await as(limited.app, owner).post("/api/groups", { name: "Spam" })).json().group.id;
      const statuses = [];
      for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
        statuses.push((await as(limited.app, owner).post(`/api/groups/${id}/invitations`, { email })).statusCode);
      }
      expect(statuses).toEqual([202, 202, 429]);
    } finally {
      await closeTestContext(limited);
    }
  });
});

describe("accepting and declining", () => {
  it("accepting joins the group and uses up the invitation", async () => {
    await invite(ana, ben.email);
    const [invitation] = await myInvitations(ben);

    const response = await as(ctx.app, ben).post(`/api/invitations/${invitation!.id}/accept`, {});

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ group: { id: groupId, name: "Trip" } });
    expect(await memberIds()).toEqual([ana.id, ben.id]);
    expect(await myInvitations(ben)).toEqual([]);
    expect((await as(ctx.app, ben).get(`/api/groups/${groupId}`)).statusCode).toBe(200);
  });

  it("declining removes the invitation without joining", async () => {
    await invite(ana, ben.email);
    const [invitation] = await myInvitations(ben);

    expect((await as(ctx.app, ben).post(`/api/invitations/${invitation!.id}/decline`, {})).statusCode).toBe(204);
    expect(await memberIds()).toEqual([ana.id]);
    expect(await myInvitations(ben)).toEqual([]);
  });

  it("nobody can accept or decline someone else's invitation", async () => {
    await invite(ana, ben.email);
    const [invitation] = await myInvitations(ben);

    for (const action of ["accept", "decline"]) {
      const response = await as(ctx.app, olive).post(`/api/invitations/${invitation!.id}/${action}`, {});
      expect(response.statusCode).toBe(404);
    }
    expect(await memberIds()).toEqual([ana.id]);
    expect(await myInvitations(ben)).toHaveLength(1);
  });

  it("requires a login", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/invitations" })).statusCode).toBe(401);
  });
});

describe("pending invitations in a group", () => {
  it("members can see and cancel them", async () => {
    await invite(ana, ben.email);
    const list = await as(ctx.app, ana).get(`/api/groups/${groupId}/invitations`);
    const [pending] = list.json().invitations as { id: string; email: string }[];
    expect(pending).toMatchObject({ email: ben.email, invitedBy: { name: "Ana" } });

    const cancel = await as(ctx.app, ana).delete(`/api/groups/${groupId}/invitations/${pending!.id}`);
    expect(cancel.statusCode).toBe(204);
    expect(await myInvitations(ben)).toEqual([]);
  });

  it("are hidden from outsiders", async () => {
    await invite(ana, ben.email);
    expect((await as(ctx.app, olive).get(`/api/groups/${groupId}/invitations`)).statusCode).toBe(404);
  });
});

describe("leaving a group", () => {
  const leave = (user: TestUser) => as(ctx.app, user).post(`/api/groups/${groupId}/leave`, {});

  it("works once your balance is settled", async () => {
    await addMember(ctx.app, ana, groupId, ben);

    expect((await leave(ben)).statusCode).toBe(204);
    expect(await memberIds()).toEqual([ana.id]);
    expect((await as(ctx.app, ben).get(`/api/groups/${groupId}`)).statusCode).toBe(404);
  });

  it("is refused while you owe money or are owed money", async () => {
    await addMember(ctx.app, ana, groupId, ben);
    await as(ctx.app, ana).post(`/api/groups/${groupId}/expenses`, {
      description: "Dinner",
      amount: 1000,
      split: { type: "EQUAL" },
    });

    const benLeaves = await leave(ben);
    const anaLeaves = await leave(ana);
    expect(benLeaves.statusCode).toBe(409);
    expect(benLeaves.json()).toMatchObject({ error: "BalanceNotSettled", message: expect.stringContaining("owe money") });
    expect(anaLeaves.json()).toMatchObject({ error: "BalanceNotSettled", message: expect.stringContaining("owes you") });

    // After settling up, leaving works.
    await as(ctx.app, ben).post(`/api/groups/${groupId}/settlements`, { toUserId: ana.id, amount: 500 });
    expect((await leave(ben)).statusCode).toBe(204);
  });

  it("closes the group when the last member leaves", async () => {
    expect((await leave(ana)).statusCode).toBe(204);
    expect(await ctx.prisma.group.count()).toBe(0);
  });

  it("is only possible for members", async () => {
    expect((await leave(olive)).statusCode).toBe(404);
  });
});
