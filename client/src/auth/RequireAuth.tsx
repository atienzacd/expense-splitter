import { Navigate, Outlet, useLocation } from "react-router";
import type { FromState } from "./redirect.ts";
import { useCurrentUser } from "./useAuth.ts";

/** Wraps pages that need a login; everyone else is sent to /login and brought back afterwards. */
export function RequireAuth() {
  const currentUser = useCurrentUser();
  const location = useLocation();

  if (currentUser.isPending) {
    return (
      <output className="block text-slate-500 dark:text-slate-400">
        Loading…
      </output>
    );
  }
  if (!currentUser.data) {
    const state: FromState = { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}
