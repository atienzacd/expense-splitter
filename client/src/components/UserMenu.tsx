import { Link, useNavigate } from "react-router";
import { useCurrentUser, useLogout } from "../auth/useAuth.ts";

const linkClass =
  "rounded-md px-2 py-1 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:hover:bg-slate-800";

/** The header's account area: log in / sign up, or the user's name and log out. */
export function UserMenu() {
  const { data: user, isPending } = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();

  if (isPending) return null;

  if (!user) {
    return (
      <nav aria-label="Account" className="flex items-center gap-1">
        <Link to="/login" className={linkClass}>
          Log in
        </Link>
        <Link to="/register" className={`${linkClass} bg-emerald-600 text-white hover:bg-emerald-700 dark:hover:bg-emerald-700`}>
          Sign up
        </Link>
      </nav>
    );
  }

  return (
    <nav aria-label="Account" className="flex items-center gap-2">
      <span className="hidden text-sm text-slate-600 sm:inline dark:text-slate-300">{user.name}</span>
      <button
        type="button"
        className={linkClass}
        disabled={logout.isPending}
        onClick={() => logout.mutate(undefined, { onSettled: () => void navigate("/", { replace: true }) })}
      >
        Log out
      </button>
    </nav>
  );
}
