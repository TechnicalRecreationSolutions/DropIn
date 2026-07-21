"use client";

import { useQuery } from "@tanstack/react-query";
import type { ExpandedSession, WeekExpandParams } from "@/types/schedule.types";
import { getWeekStart, getWeekEnd } from "@/lib/utils/dates";

async function fetchExpandedSessions(params: WeekExpandParams): Promise<ExpandedSession[]> {
  const { weekStart, weekEnd, orgId, facilityId, programId } = params;

  const url = new URL("/api/sessions/expand", window.location.origin);
  url.searchParams.set("weekStart", weekStart.toISOString());
  url.searchParams.set("weekEnd", weekEnd.toISOString());
  if (orgId) url.searchParams.set("orgId", orgId);
  if (facilityId) url.searchParams.set("facilityId", facilityId);
  if (programId) url.searchParams.set("programId", programId);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load schedule (${res.status})`);
  }

  const data: Array<Omit<ExpandedSession, "start" | "end"> & { start: string; end: string }> =
    await res.json();

  // Deserialize ISO strings back to Date objects
  return data.map((s) => ({ ...s, start: new Date(s.start), end: new Date(s.end) }));
}

interface UseWeeklyScheduleOptions {
  orgId?: string;
  facilityId?: string;
  programId?: string;
  weekStart: Date;
}

/**
 * TanStack Query wrapper for the /api/sessions/expand endpoint.
 *
 * Handles ISO→Date deserialization, caching, and loading/error state.
 * Public pages use a 60s stale time; dashboard editor callers can pass
 * staleTime: 10_000 as an override via queryClient.setQueryDefaults.
 */
export function useWeeklySchedule({
  orgId,
  facilityId,
  programId,
  weekStart,
}: UseWeeklyScheduleOptions) {
  const weekEnd = getWeekEnd(weekStart);

  return useQuery({
    queryKey: ["weekly-schedule", { orgId, facilityId, programId, weekStart: weekStart.toISOString() }],
    queryFn: () =>
      fetchExpandedSessions({ weekStart, weekEnd, orgId, facilityId, programId }),
    staleTime: 60_000,
    enabled: !!(orgId || facilityId || programId),
  });
}
