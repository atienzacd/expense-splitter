import { useState } from "react";
import type { Expense } from "../api/expenses.ts";
import type { Member } from "../api/groups.ts";
import { Button, FormAlert } from "../components/form.tsx";
import { formatPesos } from "../lib/money.ts";
import { useDeleteExpense, useExpenses } from "./queries.ts";

const dateFormat = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });

export function ExpenseList({ groupId, members, meId }: { groupId: string; members: Member[]; meId: string }) {
  const expenses = useExpenses(groupId);

  if (expenses.isPending) return <output className="block text-slate-500">Loading expenses…</output>;
  if (expenses.isError) return <FormAlert>Couldn't load the expenses. Please refresh the page.</FormAlert>;
  if (expenses.data.length === 0) {
    return <p className="text-slate-600 dark:text-slate-300">No expenses yet. Add the first one above.</p>;
  }

  // People who have since left the group still appear on old expenses.
  const names = new Map(members.map((m) => [m.id, m.id === meId ? "You" : m.name]));
  const nameOf = (id: string) => names.get(id) ?? "Former member";

  return (
    <ul className="divide-y divide-slate-200 dark:divide-slate-800">
      {expenses.data.map((expense) => (
        <ExpenseRow key={expense.id} groupId={groupId} expense={expense} nameOf={nameOf} />
      ))}
    </ul>
  );
}

function ExpenseRow({ groupId, expense, nameOf }: { groupId: string; expense: Expense; nameOf: (id: string) => string }) {
  const remove = useDeleteExpense(groupId);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-medium">{expense.description}</h3>
        <span className="font-semibold tabular-nums">{formatPesos(expense.amount)}</span>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {nameOf(expense.paidBy.id)} paid · {dateFormat.format(new Date(expense.createdAt))}
      </p>
      <ul aria-label={`Shares of ${expense.description}`} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {expense.splits.map((split) => (
          <li key={split.userId} className="tabular-nums">
            {nameOf(split.userId)} {formatPesos(split.amountOwed)}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm">Delete this expense for everyone?</span>
            <Button
              block={false}
              variant="danger"
              className="px-3 py-1 text-sm"
              loading={remove.isPending}
              onClick={() => remove.mutate(expense.id)}
            >
              Yes, delete
            </Button>
            <Button block={false} variant="secondary" className="px-3 py-1 text-sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            block={false}
            variant="secondary"
            className="px-3 py-1 text-sm"
            aria-label={`Delete ${expense.description}`}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        )}
      </div>
      {remove.isError && <FormAlert>Couldn't delete the expense. Please try again.</FormAlert>}
    </li>
  );
}
