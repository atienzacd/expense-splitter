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

type SelectFieldProps = Omit<ComponentProps<"select">, "id"> & { label: string };

export function SelectField({ label, children, className = "", ...select }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        className={`block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 dark:border-slate-700 dark:bg-slate-900 ${className}`}
        {...select}
      >
        {children}
      </select>
    </div>
  );
}

type ButtonProps = ComponentProps<"button"> & {
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
  /** Stretch to the full width of the container. */
  block?: boolean;
};

const VARIANTS = {
  primary: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
  secondary:
    "border border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800",
  danger:
    "border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950",
};

export function Button({
  loading = false,
  variant = "primary",
  block = true,
  disabled,
  children,
  className = "",
  ...button
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 ${
        block ? "w-full" : ""
      } ${VARIANTS[variant]} ${className}`}
      {...button}
    >
      {children}
    </button>
  );
}

/** A non-error message, e.g. "Invitation sent", read out when it appears. */
export function FormSuccess({ children }: { children: ReactNode }) {
  return (
    <output className="block rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
      {children}
    </output>
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
