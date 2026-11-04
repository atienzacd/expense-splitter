import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { computeBalances } from "../../lib/settle.ts";
import { email, publicUserSelect } from "../../lib/schemas.ts";
import { logSecurityEvent } from "../../security.ts";
import { groupParams, requireMembership } from "./membership.ts";

export type GroupRoutesOptions = {
  prisma: PrismaClient;
  /** Inviting is rate limited like login, to stop invitation spam. */
  inviteRateLimit: { max: number; timeWindow: string };
  /** Keyed fingerprint used instead of the email in security logs. */
  fingerprintEmail: (email: string) => string;
};

const createGroupBody = z.object({ name: z.string().trim().min(1).max(100) });
const inviteBody = z.object({ email });
const invitationParams = groupParams.extend({ invitationId: z.uuid() });

export async function groupRoutes(app: FastifyInstance, options: GroupRoutesOptions): Promise<void> {
  const { prisma, inviteRateLimit, fingerprintEmail } = options;

  app.get("/", async (request) => {
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId: request.userId } } },
      select: { id: true, name: true, createdAt: true, _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    });
    return {
      groups: groups.map(({ _count, ...group }) => ({ ...group, memberCount: _count.members })),
    };
  });

  app.post("/", async (request, reply) => {
    const { name } = createGroupBody.parse(request.body);
    const group = await prisma.group.create({
      data: {
        name,
        createdById: request.userId,
        members: { create: { userId: request.userId } },
      },
      select: { id: true, name: true, createdAt: true },
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

    const [expenses, settlements] = await Promise.all([
      prisma.expense.findMany({
        where: { groupId },
        select: { paidById: true, amount: true, splits: { select: { userId: true, amountOwed: true } } },
      }),
      prisma.settlement.findMany({ where: { groupId }, select: { fromUserId: true, toUserId: true, amount: true } }),
    ]);
    const balance = computeBalances(expenses, settlements).get(request.userId) ?? 0;
    if (balance !== 0) {
      throw new HttpError(
        409,
        "BalanceNotSettled",
        balance > 0 ? "The group still owes you money. Settle up before leaving." : "You still owe money in this group. Settle up before leaving.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.groupMember.delete({ where: { groupId_userId: { groupId, userId: request.userId } } });
      // The last person out closes the group, so no one-person-less groups linger.
      if ((await tx.groupMember.count({ where: { groupId } })) === 0) {
        await tx.group.delete({ where: { id: groupId } });
      }
    });
    logSecurityEvent(request, "group.member_left", { groupId, userId: request.userId });
    return reply.status(204).send();
  });
}
