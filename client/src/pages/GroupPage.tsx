import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { ApiError } from "../api/client.ts";
import type { GroupDetails } from "../api/groups.ts";
import { useCurrentUser } from "../auth/useAuth.ts";
import { Card } from "../components/Card.tsx";
import { AddExpenseForm } from "../expenses/AddExpenseForm.tsx";
import { ExpenseList } from "../expenses/ExpenseList.tsx";
import { Button, FormAlert, FormSuccess, TextField } from "../components/form.tsx";
import { useCancelInvitation, useGroup, useGroupInvitations, useInvite, useLeaveGroup } from "../groups/queries.ts";
import { validate } from "../lib/forms.ts";

const inviteSchema = z.object({
  email: z.string().trim().min(1, "Enter their email").pipe(z.email("Enter a valid email address")),
});

export function GroupPage() {
  const { groupId = "" } = useParams();
  const group = useGroup(groupId);
  const { data: me } = useCurrentUser();

  if (group.isPending) return <output className="block text-slate-500">Loading group…</output>;
  if (group.isError) {
    const notFound = group.error instanceof ApiError && (group.error.status === 404 || group.error.status === 400);
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">{notFound ? "Group not found" : "Couldn't load this group"}</h1>
        <p className="text-slate-600 dark:text-slate-300">
          {notFound ? "It may have been closed, or you're not a member." : "Please refresh the page to try again."}
        </p>
        <BackLink />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <BackLink />
        <h1 className="text-2xl font-bold tracking-tight">{group.data.name}</h1>
      </div>
      <Card title="Add an expense">
        <AddExpenseForm groupId={group.data.id} members={group.data.members} meId={me?.id ?? ""} />
      </Card>
      <Card title="Expenses">
        <ExpenseList groupId={group.data.id} members={group.data.members} meId={me?.id ?? ""} />
      </Card>
      <Members group={group.data} />
      <Invite groupId={group.data.id} />
      <LeaveGroup groupId={group.data.id} />
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/groups" className="text-sm font-medium text-emerald-700 underline dark:text-emerald-400">
      ← All groups
    </Link>
  );
}

function Members({ group }: { group: GroupDetails }) {
  const { data: me } = useCurrentUser();
  return (
    <Card title={`Members (${group.members.length})`}>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {group.members.map((member) => (
          <li key={member.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 first:pt-0 last:pb-0">
            <span className="font-medium">
              {member.name}
              {member.id === me?.id && <span className="text-slate-500 dark:text-slate-400"> (you)</span>}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">{member.email}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Invite({ groupId }: { groupId: string }) {
  const invite = useInvite(groupId);
  const invitations = useGroupInvitations(groupId);
  const cancel = useCancelInvitation(groupId);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [sentTo, setSentTo] = useState<string>();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSentTo(undefined);
    const result = validate(inviteSchema, { email });
    setError(result.ok ? undefined : result.errors.email);
    if (!result.ok) return;

    invite.mutate(result.data.email, {
      onSuccess: () => {
        setSentTo(result.data.email);
        setEmail("");
      },
      onError: (failure) => {
        if (failure instanceof ApiError && failure.code === "AlreadyAMember") {
          setError("That person is already in this group.");
        } else if (failure instanceof ApiError && failure.status === 429) {
          setError("You've sent a lot of invitations. Please wait a minute.");
        } else {
          setError("Couldn't send the invitation. Please try again.");
        }
      },
    });
  }

  return (
    <Card title="Invite someone">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <TextField
            label="Their email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={error}
          />
        </div>
        <Button type="submit" block={false} loading={invite.isPending} className="sm:mt-6">
          Send invite
        </Button>
      </form>
      {sentTo && (
        <div className="mt-3">
          <FormSuccess>
            Invitation sent to {sentTo}. They'll see it after logging in, or after signing up if they don't have an
            account yet.
          </FormSuccess>
        </div>
      )}

      {invitations.data && invitations.data.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-slate-500 dark:text-slate-400">Waiting to accept</h3>
          <ul className="space-y-2">
            {invitations.data.map((pending) => (
              <li key={pending.id} className="flex items-center justify-between gap-3">
                <span className="truncate">{pending.email}</span>
                <Button
                  block={false}
                  variant="secondary"
                  className="px-3 py-1 text-sm"
                  disabled={cancel.isPending}
                  aria-label={`Cancel invitation for ${pending.email}`}
                  onClick={() => cancel.mutate(pending.id)}
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function LeaveGroup({ groupId }: { groupId: string }) {
  const leave = useLeaveGroup(groupId);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const message =
    leave.error instanceof ApiError && leave.error.code === "BalanceNotSettled"
      ? leave.error.message
      : leave.isError
        ? "Couldn't leave the group. Please try again."
        : undefined;

  return (
    <div className="space-y-3 border-t border-slate-200 pt-6 dark:border-slate-800">
      {message && <FormAlert>{message}</FormAlert>}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>Leave this group? You can only rejoin if someone invites you again.</p>
          <Button
            block={false}
            variant="danger"
            loading={leave.isPending}
            onClick={() => leave.mutate(undefined, { onSuccess: () => void navigate("/groups", { replace: true }) })}
          >
            Yes, leave group
          </Button>
          <Button block={false} variant="secondary" onClick={() => setConfirming(false)}>
            Stay
          </Button>
        </div>
      ) : (
        <Button block={false} variant="danger" onClick={() => setConfirming(true)}>
          Leave group
        </Button>
      )}
    </div>
  );
}
