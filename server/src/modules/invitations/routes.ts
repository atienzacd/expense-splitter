import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { LIMITS, limitReached } from "../../lib/limits.ts";
import { logSecurityEvent } from "../../security.ts";
import { lockGroup } from "../groups/membership.ts";
import { invitationCutoff, invitationExpiresAt } from "./expiry.ts";

export type InvitationRoutesOptions = { prisma: PrismaClient };

const invitationParams = z.object({ invitationId: z.uuid() });

/** The logged-in user's own invitations: the ones addressed to their email. */
export async function invitationRoutes(app: FastifyInstance, { prisma }: InvitationRoutesOptions): Promise<void> {
  async function currentEmail(userId: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    // Only accounts can log in, and every account has an email; guests never get here.
    if (user.email === null) throw new HttpError(403, "GuestAccount", "Guests don't have invitations");
    return user.email;
  }

  /** Finds an unexpired invitation addressed to this user; anyone else's looks like it doesn't exist. */
  async function requireOwnInvitation(invitationId: string, userId: string) {
    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, email: await currentEmail(userId), createdAt: { gt: invitationCutoff() } },
      select: { id: true, groupId: true, invitedById: true },
    });
    if (!invitation) {
      throw new HttpError(404, "InvitationNotFound", "Invitation not found");
    }
    return invitation;
  }

  app.get("/", async (request) => {
    const invitations = await prisma.invitation.findMany({
      where: { email: await currentEmail(request.userId), createdAt: { gt: invitationCutoff() } },
      select: {
        id: true,
        createdAt: true,
        group: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      invitations: invitations.map((invitation) => ({ ...invitation, expiresAt: invitationExpiresAt(invitation.createdAt) })),
    };
  });

  app.post("/:invitationId/accept", async (request) => {
    const { invitationId } = invitationParams.parse(request.params);
    const invitation = await requireOwnInvitation(invitationId, request.userId);

    // Joining and using up the invitation happen together or not at all, under
    // the group's lock so the size limit can't be passed by joining at once.
    await prisma.$transaction(async (tx) => {
      await lockGroup(tx, invitation.groupId);
      if ((await tx.groupMember.count({ where: { groupId: invitation.groupId } })) >= LIMITS.membersPerGroup) {
        throw limitReached(`This group is full: a group can have at most ${LIMITS.membersPerGroup} people.`);
      }
      await tx.groupMember.upsert({
        where: { groupId_userId: { groupId: invitation.groupId, userId: request.userId } },
        create: { groupId: invitation.groupId, userId: request.userId },
        update: {},
      });
      await tx.invitation.delete({ where: { id: invitation.id } });
    });
    logSecurityEvent(request, "group.member_joined", {
      groupId: invitation.groupId,
      userId: request.userId,
      invitedById: invitation.invitedById,
    });

    const group = await prisma.group.findUniqueOrThrow({ where: { id: invitation.groupId }, select: { id: true, name: true } });
    return { group };
  });

  app.post("/:invitationId/decline", async (request, reply) => {
    const { invitationId } = invitationParams.parse(request.params);
    const invitation = await requireOwnInvitation(invitationId, request.userId);

    await prisma.invitation.delete({ where: { id: invitation.id } });
    logSecurityEvent(request, "group.invitation_declined", { groupId: invitation.groupId, userId: request.userId });
    return reply.status(204).send();
  });
}
