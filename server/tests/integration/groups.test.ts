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
let outsider: TestUser;

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
  outsider = await registerUser(ctx.app, "Olive");
});

async function createGroup(owner: TestUser, name = "Baguio trip") {
  const response = await as(ctx.app, owner).post("/api/groups", { name });
  expect(response.statusCode).toBe(201);
  return response.json().group as { id: string; name: string };
}

describe("groups", () => {
  it("requires a logged-in user", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/groups" });
    expect(response.statusCode).toBe(401);
  });

  it("creates a group with the creator as its first member", async () => {
    const group = await createGroup(ana);

    const details = await as(ctx.app, ana).get(`/api/groups/${group.id}`);
    expect(details.statusCode).toBe(200);
    expect(details.json().group).toMatchObject({
      name: "Baguio trip",
      createdById: ana.id,
      members: [{ id: ana.id, name: "Ana", email: "ana@example.com" }],
    });
  });

  it("lists only the groups you belong to", async () => {
    await createGroup(ana, "Ana's group");
    await createGroup(ben, "Ben's group");

    const response = await as(ctx.app, ana).get("/api/groups");
    expect(response.json().groups).toEqual([expect.objectContaining({ name: "Ana's group", memberCount: 1 })]);
  });

  it("hides a group from non-members as if it didn't exist", async () => {
    const group = await createGroup(ana);

    const response = await as(ctx.app, outsider).get(`/api/groups/${group.id}`);
    const missing = await as(ctx.app, outsider).get("/api/groups/0196f3a0-0000-7000-8000-000000000000");

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(missing.json());
  });

  it("rejects an invalid group id", async () => {
    const response = await as(ctx.app, ana).get("/api/groups/not-a-uuid");
    expect(response.statusCode).toBe(400);
  });

  it("validates the group name", async () => {
    const response = await as(ctx.app, ana).post("/api/groups", { name: "   " });
    expect(response.statusCode).toBe(400);
  });
});

describe("group members", () => {
  it("adds an existing user by email", async () => {
    const group = await createGroup(ana);

    const response = await as(ctx.app, ana).post(`/api/groups/${group.id}/members`, { email: "BEN@example.com" });
    expect(response.statusCode).toBe(201);
    expect(response.json().member).toEqual({ id: ben.id, name: "Ben", email: "ben@example.com" });

    // Ben can now see the group.
    const asBen = await as(ctx.app, ben).get(`/api/groups/${group.id}`);
    expect(asBen.json().group.members.map((m: { id: string }) => m.id)).toEqual([ana.id, ben.id]);
  });

  it("returns 404 for an email with no account", async () => {
    const group = await createGroup(ana);
    const response = await as(ctx.app, ana).post(`/api/groups/${group.id}/members`, { email: "nobody@example.com" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "UserNotFound" });
  });

  it("rejects adding someone twice", async () => {
    const group = await createGroup(ana);
    await as(ctx.app, ana).post(`/api/groups/${group.id}/members`, { email: ben.email });

    const response = await as(ctx.app, ana).post(`/api/groups/${group.id}/members`, { email: ben.email });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "AlreadyAMember" });
  });

  it("does not let outsiders add themselves", async () => {
    const group = await createGroup(ana);
    const response = await as(ctx.app, outsider).post(`/api/groups/${group.id}/members`, { email: outsider.email });
    expect(response.statusCode).toBe(404);
  });
});

describe("adding members by email is rate limited", () => {
  it("blocks repeated lookups from the same address", async () => {
    const limited = await createTestContext({ authRateLimit: { max: 2, timeWindow: "1 minute" } });
    try {
      const owner = await registerUser(limited.app, "Owner");
      const group = (await as(limited.app, owner).post("/api/groups", { name: "Probe" })).json().group;

      const statuses = [];
      for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
        statuses.push((await as(limited.app, owner).post(`/api/groups/${group.id}/members`, { email })).statusCode);
      }
      expect(statuses).toEqual([404, 404, 429]);
    } finally {
      await closeTestContext(limited);
    }
  });
});
