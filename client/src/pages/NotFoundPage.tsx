import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-slate-600 dark:text-slate-300">That page doesn't exist.</p>
      <Link to="/" className="font-medium text-emerald-700 underline dark:text-emerald-400">
        Go to the home page
      </Link>
    </div>
  );
}
