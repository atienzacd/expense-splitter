import { type ComponentProps, type ReactNode, useId } from "react";

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  error?: string;
  hint?: string;
};

/** A labelled input whose error message is announced by screen readers. */
export function TextField({ label, error, hint, className = "", ...input }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`block w-full rounded-lg border bg-white px-3 py-2 text-base shadow-sm outline-none transition-colors focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 dark:bg-slate-900 ${
          error ? "border-red-500 dark:border-red-400" : "border-slate-300 dark:border-slate-700"
        } ${className}`}
        {...input}
      />
      {hint && !error && (
        <p id={hintId} className="text-sm text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

type ButtonProps = ComponentProps<"button"> & { loading?: boolean };

export function Button({ loading = false, disabled, children, className = "", ...button }: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...button}
    >
      {children}
    </button>
  );
}

/** A form-level message (e.g. "Email or password is incorrect"), read out when it appears. */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      {children}
    </div>
  );
}
