"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavTree } from "@/hooks/useNavTree";
import { NO_DEPARTMENT, commandCentreHref, spacesHref, mapHref } from "@/lib/schedule/commandCentreHref";
import SidebarFilters from "./SidebarFilters";
import SidebarMenu from "./SidebarMenu";

export interface SidebarSelection {
  facilityId: string | null;
  /** A real department id, NO_DEPARTMENT, or null for "every department". */
  departmentId: string | null;
  scheduleGroupId: string | null;
}

interface SidebarNavProps {
  orgId: string;
  /** Called whenever a Menu link is clicked — used to close a mobile sheet on navigation. */
  onNavigate?: () => void;
}

/** Which facility a route is "inside", from the query string or the (redirect-only) legacy path. */
function urlFacilityId(pathname: string, params: URLSearchParams): string | null {
  return params.get("facility") ?? pathname.match(/\/facilities\/([^/]+)/)?.[1] ?? null;
}

/**
 * The current page's own scoped URL for a given selection, or null if the
 * page doesn't read facility/department/schedule from the query string at
 * all. Used so that changing a filter navigates the page you're already on
 * instead of only changing where the sidebar's Menu links happen to point —
 * without this, picking a new facility/department/schedule while sitting on
 * one of these pages silently did nothing.
 */
function scopedHrefForPath(pathname: string, selection: SidebarSelection): string | null {
  if (pathname === "/dashboard") {
    return selection.facilityId ? `/dashboard?facility=${selection.facilityId}` : "/dashboard";
  }
  if (pathname.startsWith("/dashboard/schedule")) return commandCentreHref(selection);
  if (pathname.startsWith("/dashboard/spaces")) return spacesHref(selection.facilityId);
  if (pathname.startsWith("/dashboard/map")) return mapHref(selection.facilityId);
  return null;
}

/**
 * Owns the Facility/Department/Schedule selection that drives both
 * SidebarFilters (the dropdowns) and SidebarMenu (the flat links, which
 * point wherever the current selection scopes them to). Shared between the
 * desktop <aside> and the mobile sheet so both present the same filters.
 *
 * The selection defaults to whatever the current URL already names (so the
 * sidebar reflects where you are), falling back to the org's first facility
 * — same default the Overview page itself uses.
 */
export default function SidebarNav({ orgId, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data } = useNavTree(orgId);

  const [manual, setManual] = useState<SidebarSelection>({
    facilityId: null,
    departmentId: null,
    scheduleGroupId: null,
  });

  const seededFacilityId = urlFacilityId(pathname, new URLSearchParams(searchParams.toString()));
  const facilityId = manual.facilityId ?? seededFacilityId ?? data?.facilities[0]?.id ?? null;

  const facilityDepartments = useMemo(
    () => (data?.departments ?? []).filter((d) => d.facility_id === facilityId),
    [data?.departments, facilityId]
  );

  const departmentId = facilityDepartments.length > 0 ? manual.departmentId : null;

  const facilitySchedules = useMemo(
    () => (data?.scheduleGroups ?? []).filter((g) => g.facility_id === facilityId),
    [data?.scheduleGroups, facilityId]
  );

  const scopedSchedules = useMemo(() => {
    if (departmentId === null) return facilitySchedules;
    if (departmentId === NO_DEPARTMENT) return facilitySchedules.filter((g) => !g.department_id);
    return facilitySchedules.filter((g) => g.department_id === departmentId);
  }, [facilitySchedules, departmentId]);

  const scheduleGroupId =
    manual.scheduleGroupId && scopedSchedules.some((g) => g.id === manual.scheduleGroupId)
      ? manual.scheduleGroupId
      : null;

  const selection = { facilityId, departmentId, scheduleGroupId };

  // Switching facility resets department/schedule; the manual state below
  // otherwise tracks exactly what the dropdowns show. When the page you're
  // already on is scoped by these filters, also navigate it to the new
  // scope — otherwise the dropdowns change with nothing on screen moving.
  function handleFilterChange(next: SidebarSelection) {
    setManual(next);
    const href = scopedHrefForPath(pathname, next);
    if (href) router.push(href);
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <SidebarFilters
        facilities={data?.facilities ?? []}
        departments={facilityDepartments}
        scheduleGroups={facilitySchedules}
        selection={selection}
        onChange={handleFilterChange}
      />
      <div className="border-t border-sidebar-border mx-4" />
      <SidebarMenu
        selection={selection}
        hasFacility={(data?.facilities.length ?? 0) > 0}
        onNavigate={onNavigate}
      />
    </div>
  );
}
