import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { email, publicUserSelect } from "../../lib/schemas.ts";
import { logSecurityEvent } from "../../security.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { groupParams, requireMembership } from "./membership.ts";

export type GroupRoutesOptions = {
  prisma: PrismaClient;
  /** Adding by email reveals whether an account exists, so it is rate limited like login. */
  lookupRateLimit: { max: number; timeWindow: string };
};

const createGroupBody = z.object({ name: z.string().trim().min(1).max(100) });
const addMemberBody = z.object({ email });


export async function groupRoutes(app: FastifyInstance, { prisma, lookupRateLimit }: GroupRoutesOptions): Promise<void> {
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

  app.post("/:groupId/members", { config: { rateLimit: lookupRateLimit } }, async (request, reply) => {
    const { groupId } = groupParams.parse(request.params);
    const { email: memberEmail } = addMemberBody.parse(request.body);
    await requireMembership(prisma, groupId, request.userId);

    const user = await prisma.user.findUnique({ where: { email: memberEmail }, select: publicUserSelect });
    if (!user) {
      throw new HttpError(404, "UserNotFound", "No account uses that email. Ask them to sign up first.");
    }

    try {
      await prisma.groupMember.create({ data: { groupId, userId: user.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "AlreadyAMember", `${user.name} is already in this group`);
      }
      throw error;
    }
    logSecurityEvent(request, "group.member_added", { groupId, addedUserId: user.id, byUserId: request.userId });
    return reply.status(201).send({ member: user });
  });
}
