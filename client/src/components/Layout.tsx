import { Link, Outlet } from "react-router";

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            to="/"
            className="flex items-center gap-2 rounded font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <img src="/favicon.svg" alt="" className="size-7" />
            Expense Splitter
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="mx-auto w-full max-w-3xl px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
        Built with React, Fastify and PostgreSQL.
      </footer>
    </div>
  );
}
