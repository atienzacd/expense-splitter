import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import type { MyInvitation } from "../api/groups.ts";
import { Card } from "../components/Card.tsx";
import { Button, FormAlert, TextField } from "../components/form.tsx";
import { useCreateGroup, useGroups, useMyInvitations, useRespondToInvitation } from "../groups/queries.ts";
import { validate } from "../lib/forms.ts";

const groupName = z.object({ name: z.string().trim().min(1, "Give the group a name").max(100, "Use at most 100 characters") });

export function GroupsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Your groups</h1>
      <Invitations />
      <CreateGroup />
      <GroupList />
    </div>
  );
}

function Invitations() {
  const invitations = useMyInvitations();
  if (!invitations.data?.length) return null;

  return (
    <Card title="Invitations">
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {invitations.data.map((invitation) => (
          <InvitationRow key={invitation.id} invitation={invitation} />
        ))}
      </ul>
    </Card>
  );
}

function InvitationRow({ invitation }: { invitation: MyInvitation }) {
  const respond = useRespondToInvitation();
  const navigate = useNavigate();

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <p>
        <strong>{invitation.invitedBy.name}</strong> invited you to <strong>{invitation.group.name}</strong>
      </p>
      <div className="flex gap-2">
        <Button
          block={false}
          loading={respond.isPending && respond.variables.accept}
          disabled={respond.isPending}
          onClick={() =>
            respond.mutate(
              { id: invitation.id, accept: true },
              { onSuccess: () => void navigate(`/groups/${invitation.group.id}`) },
            )
          }
        >
          Accept
        </Button>
        <Button
          block={false}
          variant="secondary"
          loading={respond.isPending && !respond.variables.accept}
          disabled={respond.isPending}
          onClick={() => respond.mutate({ id: invitation.id, accept: false })}
        >
          Decline
        </Button>
      </div>
      {respond.isError && <FormAlert>Couldn't respond to this invitation. Please try again.</FormAlert>}
    </li>
  );
}

function CreateGroup() {
  const create = useCreateGroup();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = validate(groupName, { name });
    setError(result.ok ? undefined : result.errors.name);
    if (!result.ok) return;
    create.mutate(result.data.name, { onSuccess: ({ group }) => void navigate(`/groups/${group.id}`) });
  }

  return (
    <Card title="New group">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <TextField
            label="Group name"
            placeholder="e.g. Baguio trip"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={error}
          />
        </div>
        <Button type="submit" block={false} loading={create.isPending} className="sm:mt-6">
          Create group
        </Button>
      </form>
      {create.isError && (
        <div className="mt-3">
          <FormAlert>Couldn't create the group. Please try again.</FormAlert>
        </div>
      )}
    </Card>
  );
}

function GroupList() {
  const groups = useGroups();

  if (groups.isPending) return <output className="block text-slate-500">Loading your groups…</output>;
  if (groups.isError) return <FormAlert>Couldn't load your groups. Please refresh the page.</FormAlert>;
  if (groups.data.length === 0) {
    return (
      <p className="text-slate-600 dark:text-slate-300">
        No groups yet. Create one above, or ask a friend to invite you.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {groups.data.map((group) => (
        <li key={group.id}>
          <Link
            to={`/groups/${group.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-emerald-500 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-slate-800 dark:bg-slate-900"
          >
            <span className="block font-semibold">{group.name}</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
