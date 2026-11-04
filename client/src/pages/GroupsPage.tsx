import { useCurrentUser } from "../auth/useAuth.ts";

/** Placeholder until the groups screens are built (next step). */
export function GroupsPage() {
  const { data: user } = useCurrentUser();

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight">Your groups</h1>
      <p className="text-slate-600 dark:text-slate-300">
        Hi {user?.name}! Creating groups and adding expenses is coming next.
      </p>
    </div>
  );
}
