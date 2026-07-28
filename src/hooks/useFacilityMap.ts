"use client";

import { useQuery } from "@tanstack/react-query";
import type { FacilityMap, MapContextElement, SpaceHotspotWithSpace } from "@/types/schedule.types";

async function fetchFacilityMap(facilityId: string): Promise<{
  facilityMap: FacilityMap | null;
  hotspots: SpaceHotspotWithSpace[];
  contextElements: MapContextElement[];
}> {
  const url = new URL("/api/facility-maps/public", window.location.origin);
  url.searchParams.set("facilityId", facilityId);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load facility map (${res.status})`);
  }

  return res.json();
}

/**
 * TanStack Query wrapper for the /api/facility-maps/public endpoint — the
 * published facility map plus its hotspots, for the "floorplan" schedule view.
 */
export function useFacilityMap(facilityId: string) {
  return useQuery({
    queryKey: ["facility-map", facilityId],
    queryFn: () => fetchFacilityMap(facilityId),
    staleTime: 60_000,
    enabled: !!facilityId,
  });
}
