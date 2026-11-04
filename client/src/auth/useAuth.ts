import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, login, logout, register, type User } from "../api/auth.ts";

/** Cache key for the logged-in user (null when logged out). */
export const CURRENT_USER_KEY = ["currentUser"] as const;

export function useCurrentUser() {
  return useQuery({ queryKey: CURRENT_USER_KEY, queryFn: getCurrentUser, staleTime: 5 * 60_000 });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: ({ user }) => queryClient.setQueryData<User | null>(CURRENT_USER_KEY, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: register,
    onSuccess: ({ user }) => queryClient.setQueryData<User | null>(CURRENT_USER_KEY, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    // Even if the request fails, forget everything this browser knew about the user.
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData<User | null>(CURRENT_USER_KEY, null);
    },
  });
}
