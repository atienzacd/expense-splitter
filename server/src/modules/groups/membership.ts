import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import type { Prisma } from "../../generated/prisma/client.ts";

export const groupParams = z.object({ groupId: z.uuid() });

/** Either the client itself or the client inside a transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Locks the group's row until the transaction ends. Every write that changes
 * who is in a group or what they owe takes this lock first, so a check like
 * "your balance is zero, you may leave" can't be undone by an expense added
 * at the same moment.
 */
export async function lockGroup(tx: Prisma.TransactionClient, groupId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "groups" WHERE "id" = ${groupId}::uuid FOR UPDATE`;
}

/**
 * Only members may see or change a group. Outsiders get the same 404 as for a
 * group that doesn't exist, so group ids can't be probed.
 */
export async function requireMembership(prisma: Db, groupId: string, userId: string): Promise<void> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { userId: true },
  });
  if (!membership) {
    throw new HttpError(404, "GroupNotFound", "Group not found");
  }
}

/** Throws a 400 naming any of `userIds` who are not members of the group. */
export async function requireAllMembers(prisma: Db, groupId: string, userIds: string[]): Promise<void> {
  const unique = [...new Set(userIds)];
  const members = await prisma.groupMember.findMany({
    where: { groupId, userId: { in: unique } },
    select: { userId: true },
  });
  const memberIds = new Set(members.map((m) => m.userId));
  const outsiders = unique.filter((id) => !memberIds.has(id));
  if (outsiders.length > 0) {
    throw new HttpError(400, "NotAGroupMember", `Not a member of this group: ${outsiders.join(", ")}`);
  }
}

export async function listMemberIds(prisma: Db, groupId: string): Promise<string[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
    orderBy: { joinedAt: "asc" },
  });
  return members.map((m) => m.userId);
}
