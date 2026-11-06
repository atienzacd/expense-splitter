import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../db.ts";
import { HttpError } from "../../errors.ts";
import { logSecurityEvent } from "../../security.ts";
import { ConversionError, convert, type Currency, currency, exchangeRate } from "../../lib/currency.ts";
import { centavos } from "../../lib/schemas.ts";
import { type Share, splitByPercentage, splitEqually, splitExact, splitProportionally } from "../../lib/split.ts";
import { groupParams, listMemberIds, requireAllMembers, requireMembership } from "../groups/membership.ts";

export type ExpenseRoutesOptions = { prisma: PrismaClient };

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
  // In whole minor units of `currency` (₱150.75 → 15075, ¥3,000 → 3000).
  amount: centavos,
  // Defaults to the group's currency. Any other one needs `exchangeRate`:
  // how much 1 unit of it is worth in the group's currency.
  currency: currency.optional(),
  exchangeRate: exchangeRate.optional(),
  // Defaults to the person adding the expense.
  paidById: z.uuid().optional(),
  split: splitSchema,
});

const expenseParams = groupParams.extend({ expenseId: z.uuid() });

const expenseSelect = {
  id: true,
  description: true,
  amount: true,
  originalCurrency: true,
  originalAmount: true,
  exchangeRate: true,
  splitType: true,
  createdAt: true,
  paidBy: { select: { id: true, name: true } },
  splits: { select: { userId: true, amountOwed: true } },
} as const;

type StoredExpense = {
  originalCurrency: string | null;
  originalAmount: number | null;
  exchangeRate: { toFixed(): string } | null;
};

/** Shapes an expense for the API: the original payment, if converted, as one object. */
function present<T extends StoredExpense>({ originalCurrency, originalAmount, exchangeRate: rate, ...rest }: T) {
  const original =
    originalCurrency && originalAmount !== null && rate
      ? { currency: originalCurrency, amount: originalAmount, exchangeRate: rate.toFixed() }
      : null;
  return { ...rest, original };
}

async function groupCurrency(prisma: PrismaClient, groupId: string): Promise<Currency> {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { currency: true } });
  return group.currency as Currency;
}

export async function expenseRoutes(app: FastifyInstance, { prisma }: ExpenseRoutesOptions): Promise<void> {
  app.get("/:groupId/expenses", async (request) => {
    const { groupId } = groupParams.parse(request.params);
    await requireMembership(prisma, groupId, request.userId);

    const expenses = await prisma.expense.findMany({
      where: { groupId },
      select: expenseSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { expenses: expenses.map(present) };
  });

  app.post("/:groupId/expenses", async (request, reply) => {
    const { groupId } = groupParams.parse(request.params);
    const body = createExpenseBody.parse(request.body);
    await requireMembership(prisma, groupId, request.userId);

    const paidById = body.paidById ?? request.userId;
    const target = await groupCurrency(prisma, groupId);
    const paidIn = body.currency ?? target;
    let amount = body.amount;
    let original: { originalCurrency: string; originalAmount: number; exchangeRate: string } | undefined;
    if (paidIn !== target) {
      if (!body.exchangeRate) {
        throw new HttpError(400, "ExchangeRateRequired", `Give the exchange rate from ${paidIn} to ${target}`);
      }
      try {
        amount = convert(body.amount, paidIn, target, body.exchangeRate);
      } catch (error) {
        if (error instanceof ConversionError) throw new HttpError(400, "InvalidConversion", error.message);
        throw error;
      }
      original = { originalCurrency: paidIn, originalAmount: body.amount, exchangeRate: body.exchangeRate };
    }
    const shares = await computeSplits(prisma, groupId, body.amount, amount, body.split);
    await requireAllMembers(prisma, groupId, [paidById, ...shares.map((s) => s.userId)]);
    // Tiny amounts can leave someone owing 0 (₱0.02 three ways); they aren't stored.
    const splits = shares.filter((share) => share.amountOwed > 0);

    // Creating the expense and its splits in one statement keeps them atomic.
    const expense = await prisma.expense.create({
      data: {
        groupId,
        paidById,
        description: body.description,
        amount,
        ...original,
        splitType: body.split.type,
        splits: { create: splits },
      },
      select: expenseSelect,
    });
    logSecurityEvent(request, "expense.created", {
      groupId,
      expenseId: expense.id,
      amount: expense.amount,
      currency: target,
      originalCurrency: original?.originalCurrency,
      originalAmount: original?.originalAmount,
      byUserId: request.userId,
    });
    return reply.status(201).send({ expense: present(expense) });
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

/**
 * Splits `amount` (in the group's currency). Exact shares are typed in the
 * currency that was paid, so they must add up to `paidAmount`; when that was
 * another currency, each person then gets the same proportion of `amount`.
 */
async function computeSplits(
  prisma: PrismaClient,
  groupId: string,
  paidAmount: number,
  amount: number,
  split: z.infer<typeof splitSchema>,
): Promise<Share[]> {
  switch (split.type) {
    case "EQUAL":
      return splitEqually(amount, split.userIds ?? (await listMemberIds(prisma, groupId)));
    case "EXACT": {
      const exact = splitExact(
        paidAmount,
        split.shares.map((s) => ({ userId: s.userId, amountOwed: s.amount })),
      );
      return paidAmount === amount ? exact : splitProportionally(amount, exact);
    }
    case "PERCENTAGE":
      return splitByPercentage(amount, split.shares);
  }
}
