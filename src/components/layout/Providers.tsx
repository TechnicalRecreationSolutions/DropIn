"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

/**
 * Wraps the app with all client-side providers.
 * Kept lean — add providers here only when they must wrap the full tree.
 *
 * QueryClient config:
 *   - staleTime: 60s for most queries (public schedule data)
 *   - retry: 1 — fail fast on auth errors, don't hammer the DB
 */
export default function Providers({
  children,
  devtools = true,
}: {
  children: React.ReactNode;
  /** Off for pages whose output is a document — the devtools badge is fixed-position
   *  and would otherwise print in the corner of a deck sheet in development. */
  devtools?: boolean;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {devtools && process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
