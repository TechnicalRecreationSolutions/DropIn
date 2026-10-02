"use client";

import { useQuery } from "@tanstack/react-query";

export const NEEDS_YOU_KEY = "needs-you";

/**
 * The sidebar's inbox count: how many things on the Overview are waiting on
 * this person. Refreshed every two minutes and whenever the Overview acts on
 * an item (it invalidates NEEDS_YOU_KEY), so publishing a report on the page
 * takes the number down in the sidebar at the same moment.
 */
export function useNeedsYouCount(facilityId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [NEEDS_YOU_KEY, facilityId ?? null],
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{ count: number; urgent: number }> => {
      const url = facilityId ? `/api/overview/needs?facility=${facilityId}` : "/api/overview/needs";
      const res = await fetch(url);
      if (!res.ok) return { count: 0, urgent: 0 };
      return res.json();
    },
  });
}
