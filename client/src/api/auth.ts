import { api, ApiError, post } from "./client.ts";

export type User = { id: string; name: string; email: string };

export type LoginInput = { email: string; password: string };
export type RegisterInput = { name: string; email: string; password: string };

export const login = (input: LoginInput) => post<{ user: User }>("/auth/login", input);

export const register = (input: RegisterInput) => post<{ user: User }>("/auth/register", input);

export const logout = () => post<void>("/auth/logout");

/** The logged-in user, or null when nobody is logged in. */
export async function getCurrentUser(): Promise<User | null> {
  try {
    return (await api<{ user: User }>("/auth/me")).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
