import { type FormEvent, useState } from "react";
import type { Transfer } from "../api/balances.ts";
import type { Member } from "../api/groups.ts";
import { Card } from "../components/Card.tsx";
import { Button, FormAlert, FormSuccess, SelectField, TextField } from "../components/form.tsx";
import { formatPesos, parsePesos } from "../lib/money.ts";
import { useBalances, useRecordPayment, useSettlements } from "./queries.ts";

type Props = { groupId: string; members: Member[]; meId: string };

const dateFormat = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });

/** "You" for the logged-in user, the member's name otherwise ("Former member" once they've left). */
function useNames(members: Member[], meId: string) {
  const names = new Map(members.map((m) => [m.id, m.name]));
  return (userId: string, { lower = false } = {}) =>
    userId === meId ? (lower ? "you" : "You") : (names.get(userId) ?? "Former member");
}

export function Balances({ groupId, members, meId }: Props) {
  const balances = useBalances(groupId);
  const nameOf = useNames(members, meId);
  const guestIds = new Set(members.filter((m) => m.isGuest).map((m) => m.id));
  const isGuest = (userId: string) => guestIds.has(userId);

  return (
    <Card title="Balances">
      {balances.isPending ? (
        <output className="block text-slate-500">Working out balances…</output>
      ) : balances.isError ? (
        <FormAlert>Couldn't load the balances. Please refresh the page.</FormAlert>
      ) : (
        <div className="space-y-5">
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {balances.data.balances.map((balance) => (
              <li key={balance.userId} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="font-medium">
                  {nameOf(balance.userId)}
                  {balance.isGuest && <span className="text-sm font-normal text-slate-500 dark:text-slate-400"> (guest)</span>}
                </span>
                <BalanceAmount net={balance.net} />
              </li>
            ))}
          </ul>

          <section aria-labelledby="who-pays-whom" className="space-y-3">
            <h3 id="who-pays-whom" className="font-semibold">
              Who pays whom
            </h3>
            {balances.data.transfers.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-300">Everyone is settled up.</p>
            ) : (
              <ul className="space-y-3">
                {balances.data.transfers.map((transfer) => (
                  <TransferRow
                    key={`${transfer.fromUserId}-${transfer.toUserId}`}
                    groupId={groupId}
                    transfer={transfer}
                    meId={meId}
                    isGuest={isGuest}
                    nameOf={nameOf}
                  />
                ))}
              </ul>
            )}
          </section>

          <OtherPayment groupId={groupId} members={members} meId={meId} />
        </div>
      )}
    </Card>
  );
}

function BalanceAmount({ net }: { net: number }) {
  if (net > 0) return <span className="tabular-nums text-emerald-700 dark:text-emerald-400">gets back {formatPesos(net)}</span>;
  if (net < 0) return <span className="tabular-nums text-red-700 dark:text-red-400">owes {formatPesos(-net)}</span>;
  return <span className="text-slate-500 dark:text-slate-400">settled up</span>;
}

type TransferRowProps = {
  groupId: string;
  transfer: Transfer;
  meId: string;
  isGuest: (userId: string) => boolean;
  nameOf: (userId: string, options?: { lower?: boolean }) => string;
};

/**
 * You can mark your own payments as paid. Guests can't log in, so any member
 * with an account can record theirs; nobody records for another account holder.
 */
function TransferRow({ groupId, transfer, meId, isGuest, nameOf }: TransferRowProps) {
  const record = useRecordPayment(groupId);
  const [confirming, setConfirming] = useState(false);
  const youPay = transfer.fromUserId === meId;
  const guestPays = isGuest(transfer.fromUserId);
  const canRecord = youPay || guestPays;
  const amount = formatPesos(transfer.amount);
  const sentence = `${nameOf(transfer.fromUserId)} ${youPay ? "pay" : "pays"} ${nameOf(transfer.toUserId, { lower: true })} ${amount}`;
  const question = youPay
    ? `Record that you paid ${nameOf(transfer.toUserId)} ${amount}?`
    : `Record that ${nameOf(transfer.fromUserId)} paid ${nameOf(transfer.toUserId, { lower: true })} ${amount}?`;

  return (
    <li className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="tabular-nums">{sentence}</span>
        {canRecord && !confirming && (
          <Button block={false} className="px-3 py-1.5 text-sm" onClick={() => setConfirming(true)}>
            Mark as paid
          </Button>
        )}
      </div>
      {transfer.toUserId === meId && !guestPays && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {nameOf(transfer.fromUserId)} marks it as paid after paying you.
        </p>
      )}
      {confirming && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{question} Only do this once the money has been sent.</span>
          <Button
            block={false}
            className="px-3 py-1.5 text-sm"
            loading={record.isPending}
            onClick={() =>
              record.mutate({
                ...(youPay ? {} : { fromUserId: transfer.fromUserId }),
                toUserId: transfer.toUserId,
                amount: transfer.amount,
              })
            }
          >
            {youPay ? "Yes, I've paid" : "Yes, it's paid"}
          </Button>
          <Button block={false} variant="secondary" className="px-3 py-1.5 text-sm" onClick={() => setConfirming(false)}>
            Not yet
          </Button>
        </div>
      )}
      {record.isError && <FormAlert>Couldn't record the payment. Please try again.</FormAlert>}
    </li>
  );
}

/** For partial payments, or paying someone other than the suggestion. */
function OtherPayment({ groupId, members, meId }: Props) {
  const record = useRecordPayment(groupId);
  // You can record your own payments and those of guests, who can't log in.
  const guests = members.filter((m) => m.isGuest);
  const [fromUserId, setFromUserId] = useState(meId);
  const recipients = members.filter((m) => m.id !== fromUserId);
  const [chosenTo, setToUserId] = useState(recipients[0]?.id ?? "");
  // If the payer changes to the chosen recipient, fall back to the first one left.
  const toUserId = recipients.some((m) => m.id === chosenTo) ? chosenTo : (recipients[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string>();
  const [recorded, setRecorded] = useState<string>();
  const nameOf = useNames(members, meId);

  if (members.filter((m) => m.id !== meId).length === 0) return null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setRecorded(undefined);
    const centavos = parsePesos(amount);
    setError(centavos === null ? "Enter an amount like 150 or 150.75" : undefined);
    if (centavos === null) return;
    record.mutate(
      { ...(fromUserId === meId ? {} : { fromUserId }), toUserId, amount: centavos },
      {
        onSuccess: () => {
          setRecorded(
            fromUserId === meId
              ? `Recorded ${formatPesos(centavos)} to ${nameOf(toUserId)}.`
              : `Recorded that ${nameOf(fromUserId)} paid ${nameOf(toUserId, { lower: true })} ${formatPesos(centavos)}.`,
          );
          setAmount("");
        },
      },
    );
  }

  const recipientOptions = recipients.map((member) => (
    <option key={member.id} value={member.id}>
      {member.id === meId ? `${member.name} (you)` : member.name}
    </option>
  ));

  return (
    <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <summary className="cursor-pointer font-medium">Record a different payment</summary>
      <form noValidate onSubmit={onSubmit} className="mt-3 space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">For a partial payment, or one the list above doesn't show.</p>
        <div className={`grid gap-3 ${guests.length > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {guests.length > 0 ? (
            <>
              <SelectField label="Who paid" value={fromUserId} onChange={(event) => setFromUserId(event.target.value)}>
                <option value={meId}>You</option>
                {guests.map((guest) => (
                  <option key={guest.id} value={guest.id}>
                    {guest.name} (guest)
                  </option>
                ))}
              </SelectField>
              <SelectField label="Paid to" value={toUserId} onChange={(event) => setToUserId(event.target.value)}>
                {recipientOptions}
              </SelectField>
            </>
          ) : (
            <SelectField label="You paid" value={toUserId} onChange={(event) => setToUserId(event.target.value)}>
              {recipientOptions}
            </SelectField>
          )}
          <TextField
            label="Amount paid (₱)"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={error}
          />
        </div>
        <Button type="submit" block={false} variant="secondary" loading={record.isPending}>
          Record payment
        </Button>
        {recorded && <FormSuccess>{recorded}</FormSuccess>}
        {record.isError && <FormAlert>Couldn't record the payment. Please try again.</FormAlert>}
      </form>
    </details>
  );
}

export function PaymentHistory({ groupId, members, meId }: Props) {
  const settlements = useSettlements(groupId);
  const nameOf = useNames(members, meId);

  return (
    <Card title="Payments">
      {settlements.isPending ? (
        <output className="block text-slate-500">Loading payments…</output>
      ) : settlements.isError ? (
        <FormAlert>Couldn't load the payments. Please refresh the page.</FormAlert>
      ) : settlements.data.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-300">No payments recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {settlements.data.map((settlement) => (
            <li key={settlement.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 first:pt-0 last:pb-0">
              <span>
                {nameOf(settlement.fromUserId)} paid {nameOf(settlement.toUserId, { lower: true })}
              </span>
              <span className="tabular-nums">
                {formatPesos(settlement.amount)}{" "}
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  · {dateFormat.format(new Date(settlement.createdAt))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
