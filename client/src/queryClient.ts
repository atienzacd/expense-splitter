import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api/client.ts";
import { CURRENT_USER_KEY } from "./auth/useAuth.ts";

/**
 * A 401 that survives the automatic refresh means the session is over (it
 * expired, or the user logged out on another tab). Marking the user as logged
 * out sends protected pages back to the login screen.
 */
export function createQueryClient(options: { retry?: boolean } = {}): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) {
          queryClient.setQueryData(CURRENT_USER_KEY, null);
        }
      },
    }),
    defaultOptions: {
      queries: {
        // Retrying can't fix a client error such as 401 or 404.
        retry: options.retry === false ? false : (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
  return queryClient;
}
