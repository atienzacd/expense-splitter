import { type FormEvent, useId, useState } from "react";
import { ApiError } from "../api/client.ts";
import type { SplitType } from "../api/expenses.ts";
import type { Member } from "../api/groups.ts";
import { Button, FormAlert, SelectField, TextField } from "../components/form.tsx";
import {
  convertMoney,
  type Currency,
  CURRENCY_OPTIONS,
  currencySymbol,
  formatMoney,
  isCurrency,
  parseMoney,
  parseRate,
  splitEvenly,
} from "../lib/money.ts";
import { buildExpense, type ExpenseFormErrors, type ExpenseFormValues, percentToBasisPoints } from "./buildExpense.ts";
import { useAddExpense, useExchangeRate } from "./queries.ts";

const SPLIT_TYPES: { value: SplitType; label: string }[] = [
  { value: "EQUAL", label: "Equally" },
  { value: "EXACT", label: "Exact amounts" },
  { value: "PERCENTAGE", label: "Percentages" },
];

const smallInput =
  "w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 dark:border-slate-700 dark:bg-slate-900";

const rateDate = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type Kept = Pick<ExpenseFormValues, "paidById" | "currency" | "rate"> & { splitType?: SplitType };

function emptyValues(members: Member[], { paidById, splitType = "EQUAL", currency, rate }: Kept): ExpenseFormValues {
  return {
    description: "",
    amount: "",
    currency,
    rate,
    paidById,
    splitType,
    included: Object.fromEntries(members.map((m) => [m.id, true])),
    exact: {},
    percent: {},
  };
}

type AddExpenseFormProps = { groupId: string; members: Member[]; meId: string; currency: Currency };

export function AddExpenseForm({ groupId, members, meId, currency: groupCurrency }: AddExpenseFormProps) {
  const add = useAddExpense(groupId);
  const [stored, setValues] = useState(() => emptyValues(members, { paidById: meId, currency: groupCurrency }));
  // The suggested rate fills the field until someone types their own.
  const [rateEdited, setRateEdited] = useState(false);
  const paidIn = stored.currency ?? groupCurrency;
  const converting = paidIn !== groupCurrency;
  const suggestion = useExchangeRate(paidIn, groupCurrency);
  // Members can change while the form is open (someone joins, a guest is added
  // or removed): newcomers start included in the split, and a payer who has
  // left falls back to you.
  const values: ExpenseFormValues = {
    ...stored,
    paidById: members.some((m) => m.id === stored.paidById) ? stored.paidById : meId,
    included: { ...Object.fromEntries(members.map((m) => [m.id, true])), ...stored.included },
    rate: rateEdited ? stored.rate : (suggestion.data?.rate ?? stored.rate ?? ""),
  };
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [serverError, setServerError] = useState<string>();
  const splitErrorId = useId();

  const memberIds = members.map((m) => m.id);
  // What was paid, in its own currency, and the same in the group's currency.
  const paidTotal = parseMoney(values.amount, paidIn);
  const rate = converting ? parseRate(values.rate ?? "") : null;
  const total =
    paidTotal === null
      ? null
      : !converting
        ? paidTotal
        : rate === null
          ? null
          : convertMoney(paidTotal, paidIn, groupCurrency, rate);
  const set = <K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setServerError(undefined);
    const result = buildExpense(values, memberIds, groupCurrency);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;

    add.mutate(result.expense, {
      // Keep who paid, the currency and how it's split: the next expense is often similar.
      onSuccess: () => setValues((current) => emptyValues(members, { ...current, rate: values.rate })),
      onError: (error) =>
        setServerError(error instanceof ApiError && error.status < 500 ? error.message : "Couldn't add the expense. Please try again."),
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      {serverError && <FormAlert>{serverError}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem_12rem]">
        <TextField
          label="Description"
          placeholder="e.g. Dinner at Café by the Ruins"
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
          error={errors.description}
        />
        <TextField
          label={`Amount (${currencySymbol(paidIn)})`}
          inputMode="decimal"
          placeholder={formatMoney(0, paidIn).includes(".") ? "0.00" : "0"}
          value={values.amount}
          onChange={(event) => set("amount", event.target.value)}
          error={errors.amount}
        />
        <SelectField
          label="Currency"
          value={paidIn}
          onChange={(event) => {
            if (!isCurrency(event.target.value)) return;
            set("currency", event.target.value);
            // A rate typed for another currency doesn't apply to this one.
            setRateEdited(false);
            set("rate", "");
          }}
        >
          {CURRENCY_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>

      {converting && (
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <TextField
            label={`Exchange rate: 1 ${paidIn} in ${groupCurrency}`}
            inputMode="decimal"
            placeholder={suggestion.isPending ? "Getting today's rate…" : "e.g. 0.3976"}
            value={values.rate ?? ""}
            onChange={(event) => {
              setRateEdited(true);
              set("rate", event.target.value);
            }}
            error={errors.rate}
            hint={
              suggestion.data && !rateEdited
                ? `European Central Bank rate for ${rateDate.format(new Date(suggestion.data.date))}. Change it to what you were actually charged.`
                : suggestion.isError && !rateEdited
                  ? "Couldn't get today's rate. Type the rate you were charged."
                  : undefined
            }
          />
          <output className="block text-sm tabular-nums text-slate-600 sm:mt-8 dark:text-slate-300">
            {total !== null && paidTotal !== null
              ? `${formatMoney(paidTotal, paidIn)} = ${formatMoney(total, groupCurrency)}`
              : `Shown in ${groupCurrency} after converting`}
          </output>
        </div>
      )}

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

        <ShareRows
          values={values}
          members={members}
          meId={meId}
          total={total}
          paidTotal={paidTotal}
          paidIn={paidIn}
          groupCurrency={groupCurrency}
          set={set}
        />

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
  /** In the group's currency. */
  total: number | null;
  /** In the currency it was paid in; exact amounts are typed in it. */
  paidTotal: number | null;
  paidIn: Currency;
  groupCurrency: Currency;
  set: <K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) => void;
};

/** One row per member, showing what they'd owe under the chosen split. */
function ShareRows({ values, members, meId, total, paidTotal, paidIn, groupCurrency, set }: ShareRowsProps) {
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
                {index >= 0 && shares[index] !== undefined ? formatMoney(shares[index], groupCurrency) : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (values.splitType === "EXACT") {
    const assigned = members.reduce((sum, m) => sum + (parseMoney(values.exact[m.id] ?? "", paidIn) ?? 0), 0);
    const left = paidTotal === null ? null : paidTotal - assigned;
    return (
      <>
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-3">
              <span>{name(member)}</span>
              <input

                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Amount for ${member.name} (${currencySymbol(paidIn)})`}
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
                ? `${formatMoney(left, paidIn)} left to assign`
                : `${formatMoney(-left, paidIn)} more than the total`}
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
