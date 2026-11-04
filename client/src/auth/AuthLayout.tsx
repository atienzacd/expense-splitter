import type { ReactNode } from "react";

/** The card around the login and sign-up forms. */
export function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {children}
      </div>
      <p className="text-center text-sm text-slate-600 dark:text-slate-300">{footer}</p>
    </div>
  );
}
