import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { computeBalances } from "../../lib/settle.ts";
import { currency, DEFAULT_CURRENCY } from "../../lib/currency.ts";
import { email, personName, publicUserSelect } from "../../lib/schemas.ts";
import { logSecurityEvent } from "../../security.ts";
import { groupParams, requireMembership } from "./membership.ts";

export type GroupRoutesOptions = {
  prisma: PrismaClient;
  /** Inviting is rate limited like login, to stop invitation spam. */
  inviteRateLimit: { max: number; timeWindow: string };
  /** Keyed fingerprint used instead of the email in security logs. */
  fingerprintEmail: (email: string) => string;
};

// Every amount in the group (balances, payments, expenses after converting)
// is in its currency. It can't be changed later, since stored amounts are in it.
const createGroupBody = z.object({ name: z.string().trim().min(1).max(100), currency: currency.default(DEFAULT_CURRENCY) });
const inviteBody = z.object({ email });
const invitationParams = groupParams.extend({ invitationId: z.uuid() });
const guestBody = z.object({ name: personName });
const guestParams = groupParams.extend({ guestId: z.uuid() });

export async function groupRoutes(app: FastifyInstance, options: GroupRoutesOptions): Promise<void> {
  const { prisma, inviteRateLimit, fingerprintEmail } = options;

  app.get("/", async (request) => {
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId: request.userId } } },
      select: { id: true, name: true, currency: true, createdAt: true, _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    });
    return {
      groups: groups.map(({ _count, ...group }) => ({ ...group, memberCount: _count.members })),
    };
  });

  app.post("/", async (request, reply) => {
    const { name, currency: groupCurrency } = createGroupBody.parse(request.body);
    const group = await prisma.group.create({
      data: {
        name,
        currency: groupCurrency,
        createdById: request.userId,
        members: { create: { userId: request.userId } },
      },
      select: { id: true, name: true, currency: true, createdAt: true },
    });
    return reply.status(201).send({ group });
  });

  app.get("/:groupId", async (request) => {
    const { groupId } = groupParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        currency: true,
        createdAt: true,
        createdById: true,
        members: { select: { joinedAt: true, user: { select: publicUserSelect } }, orderBy: { joinedAt: "asc" } },
      },
    });
    const { members, ...rest } = group;
    return { group: { ...rest, members: members.map(({ user, joinedAt }) => ({ ...user, joinedAt })) } };
  });

  // Invites someone by email. The answer is the same whether or not the
  // address has an account, so this can't be used to discover who's registered.
  app.post("/:groupId/invitations", { config: { rateLimit: inviteRateLimit } }, async (request, reply) => {
    const { groupId } = groupParams.parse(request.params);
    const { email: inviteeEmail } = inviteBody.parse(request.body);
    await requireMembership(prisma, groupId, request.userId);

    // Members already see each other's emails, so saying so reveals nothing new.
    const alreadyMember = await prisma.groupMember.findFirst({
      where: { groupId, user: { email: inviteeEmail } },
      select: { userId: true },
    });
    if (alreadyMember) {
      throw new HttpError(409, "AlreadyAMember", "That person is already in this group");
    }

    // Inviting the same address twice keeps the one pending invitation.
    await prisma.invitation.upsert({
      where: { groupId_email: { groupId, email: inviteeEmail } },
      create: { groupId, email: inviteeEmail, invitedById: request.userId },
      update: {},
    });
    logSecurityEvent(request, "group.member_invited", {
      groupId,
      emailFingerprint: fingerprintEmail(inviteeEmail),
      byUserId: request.userId,
    });
    return reply.status(202).send({ message: "Invitation sent" });
  });

  app.get("/:groupId/invitations", async (request) => {
    const { groupId } = groupParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    const invitations = await prisma.invitation.findMany({
      where: { groupId },
      select: { id: true, email: true, createdAt: true, invitedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return { invitations };
  });

  app.delete("/:groupId/invitations/:invitationId", async (request, reply) => {
    const { groupId, invitationId } = invitationParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    const { count } = await prisma.invitation.deleteMany({ where: { id: invitationId, groupId } });
    if (count === 0) {
      throw new HttpError(404, "InvitationNotFound", "Invitation not found");
    }
    logSecurityEvent(request, "group.invitation_cancelled", { groupId, invitationId, byUserId: request.userId });
    return reply.status(204).send();
  });

  // Members can leave once they're settled up, so nobody walks away owing money
  // (or owed money that the group would then have to forget).
  app.post("/:groupId/leave", async (request, reply) => {
    const { groupId } = groupParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    const balance = await balanceOf(prisma, groupId, request.userId);
    if (balance !== 0) {
      throw new HttpError(
        409,
        "BalanceNotSettled",
        balance > 0 ? "The group still owes you money. Settle up before leaving." : "You still owe money in this group. Settle up before leaving.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.groupMember.delete({ where: { groupId_userId: { groupId, userId: request.userId } } });
      // When the last person with an account leaves, nobody can open the group
      // any more, so it's closed, along with any guests who only existed in it.
      const accountsLeft = await tx.groupMember.count({ where: { groupId, user: { isGuest: false } } });
      if (accountsLeft === 0) {
        const guests = await tx.groupMember.findMany({ where: { groupId }, select: { userId: true } });
        await tx.group.delete({ where: { id: groupId } });
        await tx.user.deleteMany({ where: { id: { in: guests.map((g) => g.userId) }, isGuest: true } });
      }
    });
    logSecurityEvent(request, "group.member_left", { groupId, userId: request.userId });
    return reply.status(204).send();
  });

  // Adds someone by name only: a guest with no account, who can't log in and
  // exists only in this group. Members record their expenses and payments.
  app.post("/:groupId/guests", async (request, reply) => {
    const { groupId } = groupParams.parse(request.params);
    const { name } = guestBody.parse(request.body);
    await requireMembership(prisma, groupId, request.userId);

    // Two people with the same name would make balances ambiguous.
    const sameName = await prisma.groupMember.findFirst({
      where: { groupId, user: { name: { equals: name, mode: "insensitive" } } },
      select: { userId: true },
    });
    if (sameName) {
      throw new HttpError(409, "NameTaken", "Someone in this group already has that name. Add a surname or initial.");
    }

    const guest = await prisma.user.create({
      data: { name, isGuest: true, memberships: { create: { groupId } } },
      select: publicUserSelect,
    });
    logSecurityEvent(request, "group.guest_added", { groupId, guestId: guest.id, byUserId: request.userId });
    return reply.status(201).send({ member: guest });
  });

  // Removes a guest (e.g. added by mistake) once they're settled up. Their name
  // stays on past expenses and payments, which keep the group's history whole.
  app.delete("/:groupId/guests/:guestId", async (request, reply) => {
    const { groupId, guestId } = guestParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    const membership = await prisma.groupMember.findFirst({
      where: { groupId, userId: guestId, user: { isGuest: true } },
      select: { userId: true },
    });
    if (!membership) {
      throw new HttpError(404, "GuestNotFound", "Guest not found");
    }
    if ((await balanceOf(prisma, groupId, guestId)) !== 0) {
      throw new HttpError(409, "BalanceNotSettled", "This guest still owes or is owed money. Settle up first.");
    }

    await prisma.groupMember.delete({ where: { groupId_userId: { groupId, userId: guestId } } });
    logSecurityEvent(request, "group.guest_removed", { groupId, guestId, byUserId: request.userId });
    return reply.status(204).send();
  });
}

/** What the group owes `userId` (positive) or they owe the group (negative), in centavos. */
async function balanceOf(prisma: PrismaClient, groupId: string, userId: string): Promise<number> {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId },
      select: { paidById: true, amount: true, splits: { select: { userId: true, amountOwed: true } } },
    }),
    prisma.settlement.findMany({ where: { groupId }, select: { fromUserId: true, toUserId: true, amount: true } }),
  ]);
  return computeBalances(expenses, settlements).get(userId) ?? 0;
}
