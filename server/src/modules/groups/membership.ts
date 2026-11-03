import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";

export const groupParams = z.object({ groupId: z.uuid() });

/**
 * Only members may see or change a group. Outsiders get the same 404 as for a
 * group that doesn't exist, so group ids can't be probed.
 */
export async function requireMembership(prisma: PrismaClient, groupId: string, userId: string): Promise<void> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { userId: true },
  });
  if (!membership) {
    throw new HttpError(404, "GroupNotFound", "Group not found");
  }
}

/** Throws a 400 naming any of `userIds` who are not members of the group. */
export async function requireAllMembers(prisma: PrismaClient, groupId: string, userIds: string[]): Promise<void> {
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

export async function listMemberIds(prisma: PrismaClient, groupId: string): Promise<string[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
    orderBy: { joinedAt: "asc" },
  });
  return members.map((m) => m.userId);
}
