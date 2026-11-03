import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { logSecurityEvent } from "../../security.ts";
import { computeBalances, simplifyDebts } from "../../lib/settle.ts";
import { centavos } from "../expenses/routes.ts";
import { groupParams, requireAllMembers, requireMembership } from "../groups/membership.ts";

export type BalanceRoutesOptions = { prisma: PrismaClient };

// You record payments you made; `from` is always the logged-in user.
const createSettlementBody = z.object({ toUserId: z.uuid(), amount: centavos });

const settlementSelect = {
  id: true,
  fromUserId: true,
  toUserId: true,
  amount: true,
  createdAt: true,
} as const;

export async function balanceRoutes(app: FastifyInstance, { prisma }: BalanceRoutesOptions): Promise<void> {
  app.get("/:groupId/balances", async (request) => {
    const { groupId } = groupParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    const [members, expenses, settlements] = await Promise.all([
      prisma.groupMember.findMany({
        where: { groupId },
        select: { user: { select: { id: true, name: true } } },
        orderBy: { joinedAt: "asc" },
      }),
      prisma.expense.findMany({
        where: { groupId },
        select: { paidById: true, amount: true, splits: { select: { userId: true, amountOwed: true } } },
      }),
      prisma.settlement.findMany({
        where: { groupId },
        select: { fromUserId: true, toUserId: true, amount: true },
      }),
    ]);

    const net = computeBalances(expenses, settlements);
    // Every member is listed, including those with nothing owed either way.
    const balances = members.map(({ user }) => ({ userId: user.id, name: user.name, net: net.get(user.id) ?? 0 }));
    return { balances, transfers: simplifyDebts(net) };
  });

  app.get("/:groupId/settlements", async (request) => {
    const { groupId } = groupParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    const settlements = await prisma.settlement.findMany({
      where: { groupId },
      select: settlementSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { settlements };
  });

  app.post("/:groupId/settlements", async (request, reply) => {
    const { groupId } = groupParams.parse(request.params);
    const { toUserId, amount } = createSettlementBody.parse(request.body);
    await requireMembership(prisma, groupId, request.userId);

    if (toUserId === request.userId) {
      throw new HttpError(400, "InvalidSettlement", "You can't record a payment to yourself");
    }
    await requireAllMembers(prisma, groupId, [toUserId]);

    const settlement = await prisma.settlement.create({
      data: { groupId, fromUserId: request.userId, toUserId, amount },
      select: settlementSelect,
    });
    logSecurityEvent(request, "settlement.created", {
      groupId,
      settlementId: settlement.id,
      amount,
      toUserId,
      byUserId: request.userId,
    });
    return reply.status(201).send({ settlement });
  });
}
