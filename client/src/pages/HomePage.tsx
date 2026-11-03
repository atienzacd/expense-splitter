import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../api/health.ts";

export function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Split bills without the awkward math.</h1>
        <p className="max-w-prose text-lg text-slate-600 dark:text-slate-300">
          Track shared expenses with friends, roommates or travel buddies, and see the fewest payments needed to
          settle up.
        </p>
      </section>

      <ServerStatus />
    </div>
  );
}

function ServerStatus() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });

  const state = health.isPending ? "checking" : health.isSuccess ? "online" : "offline";
  const label = {
    checking: "Checking the server…",
    online: "Server online, database connected",
    // The npm hint is for developers only; real users just see that it's down.
    offline: import.meta.env.DEV
      ? "Server unavailable. Is it running? Try npm run dev:server."
      : "Server unavailable. Please try again in a moment.",
  }[state];
  const dot = { checking: "bg-slate-400", online: "bg-emerald-500", offline: "bg-red-500" }[state];

  return (
    <section
      aria-labelledby="status-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 id="status-heading" className="text-sm font-medium text-slate-500 dark:text-slate-400">
        Status
      </h2>
      <output className="mt-1 flex items-center gap-2">
        <span aria-hidden="true" className={`size-2.5 rounded-full ${dot}`} />
        {label}
      </output>
    </section>
  );
}
