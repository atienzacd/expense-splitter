import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailFingerprint } from "../../src/security.ts";
import {
  as,
  closeTestContext,
  createTestContext,
  registerUser,
  resetDatabase,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;
const logs: Record<string, unknown>[] = [];

beforeAll(async () => {
  ctx = await createTestContext({
    logger: { level: "info", stream: { write: (line) => logs.push(JSON.parse(line)) } },
  });
});

afterAll(async () => {
  await closeTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  logs.length = 0;
});

const events = (name: string) => logs.filter((line) => line.securityEvent === name);

describe("security event log", () => {
  it("records registration and successful and failed logins without secrets", async () => {
    const ana = await registerUser(ctx.app, "Ana");
    await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: ana.email, password: "a-long-test-password" },
    });
    await ctx.app.inject({ method: "POST", url: "/auth/login", payload: { email: ana.email, password: "wrong-guess" } });
    await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@example.com", password: "wrong-guess" },
    });

    expect(events("auth.registered")).toEqual([expect.objectContaining({ userId: ana.id })]);
    expect(events("auth.login_succeeded")).toEqual([expect.objectContaining({ userId: ana.id })]);
    expect(events("auth.login_failed")).toEqual([
      expect.objectContaining({ reason: "wrong_password", emailFingerprint: emailFingerprint(ana.email) }),
      expect.objectContaining({ reason: "unknown_email", emailFingerprint: emailFingerprint("nobody@example.com") }),
    ]);

    const output = JSON.stringify(logs);
    for (const secret of ["a-long-test-password", "wrong-guess", ana.token, ana.email, "nobody@example.com"]) {
      expect(output).not.toContain(secret);
    }
  });

  it("records outsiders trying to reach a group", async () => {
    const ana = await registerUser(ctx.app, "Ana");
    const olive = await registerUser(ctx.app, "Olive");
    const groupId = (await as(ctx.app, ana).post("/groups", { name: "Private" })).json().group.id;

    await as(ctx.app, olive).get(`/groups/${groupId}/balances`);

    expect(events("access.denied")).toEqual([
      expect.objectContaining({ userId: olive.id, route: "/groups/:groupId/balances", level: 40 }),
    ]);
  });

  it("records membership changes and deleted expenses", async () => {
    const ana = await registerUser(ctx.app, "Ana");
    const ben = await registerUser(ctx.app, "Ben");
    const groupId = (await as(ctx.app, ana).post("/groups", { name: "Trip" })).json().group.id;
    await as(ctx.app, ana).post(`/groups/${groupId}/members`, { email: ben.email });
    const expenseId = (
      await as(ctx.app, ana).post(`/groups/${groupId}/expenses`, {
        description: "Dinner",
        amount: 1000,
        split: { type: "EQUAL" },
      })
    ).json().expense.id;
    await as(ctx.app, ben).delete(`/groups/${groupId}/expenses/${expenseId}`);

    expect(events("group.member_added")).toEqual([
      expect.objectContaining({ groupId, addedUserId: ben.id, byUserId: ana.id }),
    ]);
    expect(events("expense.deleted")).toEqual([expect.objectContaining({ groupId, expenseId, byUserId: ben.id })]);
  });
});
