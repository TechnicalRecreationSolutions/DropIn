import type { NoticeSeverity } from "@/types/app.types";
import type { FacilityGridItem } from "@/components/facilities/FacilityGridCard";

/**
 * One facility as the map page needs it. Everything the old grid card showed,
 * plus where the building is. Plain data, built on the server in
 * dashboard/facilities/page.tsx — the list is never fetched from the client.
 */
export interface FacilityMapItem extends FacilityGridItem {
  /** Null when the address has not been found (yet) — see `locationState`. */
  lat: number | null;
  lng: number | null;
  /**
   * Migration 052's convention, read off `lat` and `geocoded_at`:
   *  - "located"   — has coordinates; gets a pin.
   *  - "pending"   — never looked up (`geocoded_at` null): "No location yet".
   *  - "not_found" — looked up and not found: "Address not found — check it".
   */
  locationState: "located" | "pending" | "not_found";
  live_notice_count: number;
  worst_notice_severity: NoticeSeverity | null;
}

export type LocatedFacility = FacilityMapItem & { lat: number; lng: number };

export function isLocated(f: FacilityMapItem): f is LocatedFacility {
  return f.lat !== null && f.lng !== null;
}

export const LOCATION_COPY: Record<Exclude<FacilityMapItem["locationState"], "located">, string> = {
  pending: "No location yet",
  not_found: "Address not found — check it",
};

/** The edit page's street-address field (FacilityForm's `#address_line1`). */
export function addressHref(facilityId: string): string {
  return `/dashboard/facilities/${facilityId}/edit#address_line1`;
}

export function countsLine(f: Pick<FacilityMapItem, "department_count" | "schedule_count">): string {
  const d = `${f.department_count} department${f.department_count === 1 ? "" : "s"}`;
  const s = `${f.schedule_count} schedule${f.schedule_count === 1 ? "" : "s"}`;
  return `${d} · ${s}`;
}
