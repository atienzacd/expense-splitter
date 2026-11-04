import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import type { RegisterInput } from "../api/auth.ts";
import { ApiError } from "../api/client.ts";
import { AuthLayout } from "../auth/AuthLayout.tsx";
import { useReturnPath } from "../auth/redirect.ts";
import { registerSchema } from "../auth/schemas.ts";
import { useCurrentUser, useRegister } from "../auth/useAuth.ts";
import { Button, FormAlert, TextField } from "../components/form.tsx";
import { type FieldErrors, validate } from "../lib/forms.ts";

export function RegisterPage() {
  const currentUser = useCurrentUser();
  const register = useRegister();
  const navigate = useNavigate();
  const returnPath = useReturnPath();
  const [values, setValues] = useState<RegisterInput>({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<RegisterInput>>({});
  const [formError, setFormError] = useState<string>();

  if (currentUser.data) return <Navigate to={returnPath} replace />;

  const update = (field: keyof RegisterInput) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);
    const result = validate(registerSchema, values);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;

    register.mutate(result.data, {
      onSuccess: () => void navigate(returnPath, { replace: true }),
      onError: (error) => {
        if (error instanceof ApiError && error.code === "EmailTaken") {
          setErrors({ email: "An account with this email already exists." });
        } else if (error instanceof ApiError && error.status === 429) {
          setFormError("Too many attempts. Please wait a minute and try again.");
        } else {
          setFormError("Couldn't create your account right now. Please try again.");
        }
      },
    });
  }

  return (
    <AuthLayout
      title="Create an account"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" state={{ from: returnPath }} className="font-medium text-emerald-700 underline dark:text-emerald-400">
            Log in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {formError && <FormAlert>{formError}</FormAlert>}
        <TextField label="Name" autoComplete="name" value={values.name} onChange={update("name")} error={errors.name} />
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
          autoComplete="new-password"
          hint="At least 8 characters."
          value={values.password}
          onChange={update("password")}
          error={errors.password}
        />
        <Button type="submit" loading={register.isPending}>
          {register.isPending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
