import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { logSecurityEvent } from "../../security.ts";
import { type Share, splitByPercentage, splitEqually, splitExact } from "../../lib/split.ts";
import { groupParams, listMemberIds, requireAllMembers, requireMembership } from "../groups/membership.ts";

export type ExpenseRoutesOptions = { prisma: PrismaClient };

// Amounts are whole centavos and must fit the database's 32-bit integer column.
export const centavos = z.number().int().positive().max(2_147_483_647);

const splitSchema = z.discriminatedUnion("type", [
  // Leave out userIds to split between everyone in the group.
  z.object({ type: z.literal("EQUAL"), userIds: z.array(z.uuid()).min(1).optional() }),
  z.object({
    type: z.literal("EXACT"),
    shares: z.array(z.object({ userId: z.uuid(), amount: centavos })).min(1),
  }),
  z.object({
    type: z.literal("PERCENTAGE"),
    shares: z.array(z.object({ userId: z.uuid(), percent: z.number().positive().max(100) })).min(1),
  }),
]);

const createExpenseBody = z.object({
  description: z.string().trim().min(1).max(200),
  amount: centavos,
  // Defaults to the person adding the expense.
  paidById: z.uuid().optional(),
  split: splitSchema,
});

const expenseParams = groupParams.extend({ expenseId: z.uuid() });

const expenseSelect = {
  id: true,
  description: true,
  amount: true,
  splitType: true,
  createdAt: true,
  paidBy: { select: { id: true, name: true } },
  splits: { select: { userId: true, amountOwed: true } },
} as const;

export async function expenseRoutes(app: FastifyInstance, { prisma }: ExpenseRoutesOptions): Promise<void> {
  app.get("/:groupId/expenses", async (request) => {
    const { groupId } = groupParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    const expenses = await prisma.expense.findMany({
      where: { groupId },
      select: expenseSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { expenses };
  });

  app.post("/:groupId/expenses", async (request, reply) => {
    const { groupId } = groupParams.parse(request.params);
    const body = createExpenseBody.parse(request.body);
    await requireMembership(prisma, groupId, request.userId);

    const paidById = body.paidById ?? request.userId;
    const splits = await computeSplits(prisma, groupId, body.amount, body.split);
    await requireAllMembers(prisma, groupId, [paidById, ...splits.map((s) => s.userId)]);

    // Creating the expense and its splits in one statement keeps them atomic.
    const expense = await prisma.expense.create({
      data: {
        groupId,
        paidById,
        description: body.description,
        amount: body.amount,
        splitType: body.split.type,
        splits: { create: splits },
      },
      select: expenseSelect,
    });
    return reply.status(201).send({ expense });
  });

  app.delete("/:groupId/expenses/:expenseId", async (request, reply) => {
    const { groupId, expenseId } = expenseParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    // Scoping by groupId stops a member of one group deleting another group's expense.
    const { count } = await prisma.expense.deleteMany({ where: { id: expenseId, groupId } });
    if (count === 0) {
      throw new HttpError(404, "ExpenseNotFound", "Expense not found");
    }
    logSecurityEvent(request, "expense.deleted", { groupId, expenseId, byUserId: request.userId });
    return reply.status(204).send();
  });
}

async function computeSplits(
  prisma: PrismaClient,
  groupId: string,
  amount: number,
  split: z.infer<typeof splitSchema>,
): Promise<Share[]> {
  switch (split.type) {
    case "EQUAL":
      return splitEqually(amount, split.userIds ?? (await listMemberIds(prisma, groupId)));
    case "EXACT":
      return splitExact(
        amount,
        split.shares.map((s) => ({ userId: s.userId, amountOwed: s.amount })),
      );
    case "PERCENTAGE":
      return splitByPercentage(amount, split.shares);
  }
}
