import { useLocation } from "react-router";

/** Where to go after logging in when nothing else was asked for. */
export const AFTER_LOGIN = "/groups";

export type FromState = { from?: string };

/**
 * The page the user was trying to open before being sent to log in. Only
 * paths inside this app are accepted, so a crafted link can't send someone
 * to another website after they log in (an "open redirect").
 */
export function useReturnPath(): string {
  const state = useLocation().state as FromState | null;
  const from = state?.from;
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : AFTER_LOGIN;
}
