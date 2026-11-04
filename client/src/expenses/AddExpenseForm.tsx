import { type FormEvent, useId, useState } from "react";
import { ApiError } from "../api/client.ts";
import type { SplitType } from "../api/expenses.ts";
import type { Member } from "../api/groups.ts";
import { Button, FormAlert, SelectField, TextField } from "../components/form.tsx";
import { formatPesos, parsePesos, splitEvenly } from "../lib/money.ts";
import { buildExpense, type ExpenseFormErrors, type ExpenseFormValues, percentToBasisPoints } from "./buildExpense.ts";
import { useAddExpense } from "./queries.ts";

const SPLIT_TYPES: { value: SplitType; label: string }[] = [
  { value: "EQUAL", label: "Equally" },
  { value: "EXACT", label: "Exact amounts" },
  { value: "PERCENTAGE", label: "Percentages" },
];

const smallInput =
  "w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 dark:border-slate-700 dark:bg-slate-900";

function emptyValues(members: Member[], paidById: string, splitType: SplitType = "EQUAL"): ExpenseFormValues {
  return {
    description: "",
    amount: "",
    paidById,
    splitType,
    included: Object.fromEntries(members.map((m) => [m.id, true])),
    exact: {},
    percent: {},
  };
}

export function AddExpenseForm({ groupId, members, meId }: { groupId: string; members: Member[]; meId: string }) {
  const add = useAddExpense(groupId);
  const [values, setValues] = useState(() => emptyValues(members, meId));
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [serverError, setServerError] = useState<string>();
  const splitErrorId = useId();

  const memberIds = members.map((m) => m.id);
  const total = parsePesos(values.amount);
  const set = <K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setServerError(undefined);
    const result = buildExpense(values, memberIds);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;

    add.mutate(result.expense, {
      // Keep who paid and how it's split: the next expense is often similar.
      onSuccess: () => setValues((current) => emptyValues(members, current.paidById, current.splitType)),
      onError: (error) =>
        setServerError(error instanceof ApiError && error.status < 500 ? error.message : "Couldn't add the expense. Please try again."),
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      {serverError && <FormAlert>{serverError}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <TextField
          label="Description"
          placeholder="e.g. Dinner at Café by the Ruins"
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
          error={errors.description}
        />
        <TextField
          label="Amount (₱)"
          inputMode="decimal"
          placeholder="0.00"
          value={values.amount}
          onChange={(event) => set("amount", event.target.value)}
          error={errors.amount}
        />
      </div>

      <SelectField label="Paid by" value={values.paidById} onChange={(event) => set("paidById", event.target.value)}>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.id === meId ? `${member.name} (you)` : member.name}
          </option>
        ))}
      </SelectField>

      <fieldset aria-describedby={errors.split ? splitErrorId : undefined} className="space-y-3">
        <legend className="mb-1 text-sm font-medium">Split</legend>
        <div className="flex flex-wrap gap-2">
          {SPLIT_TYPES.map((type) => (
            <label
              key={type.value}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-emerald-600 ${
                values.splitType === type.value
                  ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                  : "border-slate-300 dark:border-slate-700"
              }`}
            >
              <input
                type="radio"
                name="splitType"
                value={type.value}
                checked={values.splitType === type.value}
                onChange={() => set("splitType", type.value)}
                className="sr-only"
              />
              {type.label}
            </label>
          ))}
        </div>

        <ShareRows values={values} members={members} meId={meId} total={total} set={set} />

        {errors.split && (
          <p id={splitErrorId} className="text-sm text-red-600 dark:text-red-400">
            {errors.split}
          </p>
        )}
      </fieldset>

      <Button type="submit" block={false} loading={add.isPending}>
        Add expense
      </Button>
    </form>
  );
}

type ShareRowsProps = {
  values: ExpenseFormValues;
  members: Member[];
  meId: string;
  total: number | null;
  set: <K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) => void;
};

/** One row per member, showing what they'd owe under the chosen split. */
function ShareRows({ values, members, meId, total, set }: ShareRowsProps) {
  const name = (member: Member) => (member.id === meId ? `${member.name} (you)` : member.name);

  if (values.splitType === "EQUAL") {
    const included = members.filter((m) => values.included[m.id]);
    const shares = total === null ? [] : splitEvenly(total, included.length);
    return (
      <ul className="space-y-2">
        {members.map((member) => {
          const index = included.indexOf(member);
          return (
            <li key={member.id} className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={values.included[member.id] ?? false}
                  onChange={(event) => set("included", { ...values.included, [member.id]: event.target.checked })}
                  className="size-4 accent-emerald-600"
                />
                {name(member)}
              </label>
              <span className="text-sm tabular-nums text-slate-500 dark:text-slate-400">
                {index >= 0 && shares[index] !== undefined ? formatPesos(shares[index]) : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (values.splitType === "EXACT") {
    const assigned = members.reduce((sum, m) => sum + (parsePesos(values.exact[m.id] ?? "") ?? 0), 0);
    const left = total === null ? null : total - assigned;
    return (
      <>
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-3">
              <span>{name(member)}</span>
              <input

                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Amount for ${member.name} (₱)`}
                value={values.exact[member.id] ?? ""}
                onChange={(event) => set("exact", { ...values.exact, [member.id]: event.target.value })}
                className={smallInput}
              />
            </li>
          ))}
        </ul>
        {left !== null && (
          <p className="text-sm tabular-nums text-slate-600 dark:text-slate-300">
            {left === 0
              ? "All of it is assigned."
              : left > 0
                ? `${formatPesos(left)} left to assign`
                : `${formatPesos(-left)} more than the total`}
          </p>
        )}
      </>
    );
  }

  const points = members.reduce((sum, m) => sum + (percentToBasisPoints(values.percent[m.id] ?? "") ?? 0), 0);
  return (
    <>
      <ul className="space-y-2">
        {members.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-3">
            <span>{name(member)}</span>
            <span className="flex items-center gap-1">
              <input

                inputMode="decimal"
                placeholder="0"
                aria-label={`Percentage for ${member.name}`}
                value={values.percent[member.id] ?? ""}
                onChange={(event) => set("percent", { ...values.percent, [member.id]: event.target.value })}
                className={smallInput}
              />
              <span aria-hidden="true">%</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm tabular-nums text-slate-600 dark:text-slate-300">
        {points === 10_000 ? "Adds up to 100%." : `${(points / 100).toFixed(2).replace(/\.00$/, "")}% of 100%`}
      </p>
    </>
  );
}
