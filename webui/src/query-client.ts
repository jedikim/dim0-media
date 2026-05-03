import { QueryClient } from "@tanstack/react-query"


/**
 * App-wide React Query client. Exported as a module singleton so non-React
 * code (Zustand stores, plain async helpers) can call `invalidateQueries`
 * without going through the `useQueryClient` hook.
 */
export const queryClient = new QueryClient()
