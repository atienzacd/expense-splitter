import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import type { LoginInput } from "../api/auth.ts";
import { ApiError } from "../api/client.ts";
import { AuthLayout } from "../auth/AuthLayout.tsx";
import { useReturnPath } from "../auth/redirect.ts";
import { loginSchema } from "../auth/schemas.ts";
import { useCurrentUser, useLogin } from "../auth/useAuth.ts";
import { Button, FormAlert, TextField } from "../components/form.tsx";
import { type FieldErrors, validate } from "../lib/forms.ts";

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "InvalidCredentials") return "Email or password is incorrect.";
    if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  }
  return "Couldn't log in right now. Please try again.";
}

export function LoginPage() {
  const currentUser = useCurrentUser();
  const login = useLogin();
  const navigate = useNavigate();
  const returnPath = useReturnPath();
  const [values, setValues] = useState<LoginInput>({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<LoginInput>>({});

  if (currentUser.data) return <Navigate to={returnPath} replace />;

  const update = (field: keyof LoginInput) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = validate(loginSchema, values);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;
    login.mutate(result.data, { onSuccess: () => void navigate(returnPath, { replace: true }) });
  }

  return (
    <AuthLayout
      title="Log in"
      footer={
        <>
          New here?{" "}
          <Link to="/register" state={{ from: returnPath }} className="font-medium text-emerald-700 underline dark:text-emerald-400">
            Create an account
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {login.isError && <FormAlert>{loginErrorMessage(login.error)}</FormAlert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={update("email")}
          error={errors.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={update("password")}
          error={errors.password}
        />
        <Button type="submit" loading={login.isPending}>
          {login.isPending ? "Logging in…" : "Log in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
