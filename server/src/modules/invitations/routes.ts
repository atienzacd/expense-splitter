import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { logSecurityEvent } from "../../security.ts";

export type InvitationRoutesOptions = { prisma: PrismaClient };

const invitationParams = z.object({ invitationId: z.uuid() });

/** The logged-in user's own invitations: the ones addressed to their email. */
export async function invitationRoutes(app: FastifyInstance, { prisma }: InvitationRoutesOptions): Promise<void> {
  async function currentEmail(userId: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    return user.email;
  }

  /** Finds an invitation addressed to this user; anyone else's looks like it doesn't exist. */
  async function requireOwnInvitation(invitationId: string, userId: string) {
    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, email: await currentEmail(userId) },
      select: { id: true, groupId: true, invitedById: true },
    });
    if (!invitation) {
      throw new HttpError(404, "InvitationNotFound", "Invitation not found");
    }
    return invitation;
  }

  app.get("/", async (request) => {
    const invitations = await prisma.invitation.findMany({
      where: { email: await currentEmail(request.userId) },
      select: {
        id: true,
        createdAt: true,
        group: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return { invitations };
  });

  app.post("/:invitationId/accept", async (request) => {
    const { invitationId } = invitationParams.parse(request.params);
    const invitation = await requireOwnInvitation(invitationId, request.userId);

    // Joining and using up the invitation happen together or not at all.
    await prisma.$transaction([
      prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: invitation.groupId, userId: request.userId } },
        create: { groupId: invitation.groupId, userId: request.userId },
        update: {},
      }),
      prisma.invitation.delete({ where: { id: invitation.id } }),
    ]);
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
