import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { logSecurityEvent } from "../../security.ts";
import { computeBalances, simplifyDebts } from "../../lib/settle.ts";
import { centavos } from "../../lib/schemas.ts";
import { groupParams, requireAllMembers, requireMembership } from "../groups/membership.ts";

export type BalanceRoutesOptions = { prisma: PrismaClient };

// You record payments you made. You can also record a payment made by a guest
// (who can't log in to do it), but never on behalf of someone with an account.
const createSettlementBody = z.object({ fromUserId: z.uuid().optional(), toUserId: z.uuid(), amount: centavos });

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
        select: { user: { select: { id: true, name: true, isGuest: true } } },
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
    const balances = members.map(({ user }) => ({
      userId: user.id,
      name: user.name,
      isGuest: user.isGuest,
      net: net.get(user.id) ?? 0,
    }));
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
    const body = createSettlementBody.parse(request.body);
    const { toUserId, amount } = body;
    const fromUserId = body.fromUserId ?? request.userId;
    await requireMembership(prisma, groupId, request.userId);

    if (toUserId === fromUserId) {
      throw new HttpError(400, "InvalidSettlement", "A payment needs two different people");
    }
    await requireAllMembers(prisma, groupId, [fromUserId, toUserId]);
    if (fromUserId !== request.userId) {
      const payer = await prisma.user.findUniqueOrThrow({ where: { id: fromUserId }, select: { isGuest: true } });
      if (!payer.isGuest) {
        throw new HttpError(403, "NotYourPayment", "Only they can record their own payments.");
      }
    }

    const settlement = await prisma.settlement.create({
      data: { groupId, fromUserId, toUserId, amount },
      select: settlementSelect,
    });
    logSecurityEvent(request, "settlement.created", {
      groupId,
      settlementId: settlement.id,
      amount,
      fromUserId,
      toUserId,
      byUserId: request.userId,
    });
    return reply.status(201).send({ settlement });
  });
}
