"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Building2,
  LayoutDashboard,
  Database,
  CreditCard,
  CalendarRange,
  Plus,
} from "lucide-react";
import { useNavTree } from "@/hooks/useNavTree";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import TreeNavNode from "./TreeNavNode";

export const topLinks = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  // Sits above the building list rather than with Data Sources/Billing below:
  // seasons are what the buildings are scheduled *into*, not a back-office
  // utility. Deliberately not added to the mobile bottom bar — that's at its
  // four-item limit, and seasons are reachable there from the command centre's
  // own picker.
  { href: "/dashboard/seasons", label: "Seasons", icon: CalendarRange, exact: false },
];

export const bottomLinks = [
  { href: "/dashboard/data-sources", label: "Data Sources", icon: Database },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

/**
 * A facility opens its workspace — the command centre scoped to that
 * building, where its departments, schedules, spaces, map, and widget all
 * live as filters and tabs.
 */
export function facilityRoute(facilityId: string) {
  return commandCentreHref({ facilityId });
}

/** Which facility a route is "inside", from the path or the command centre's scope. */
function activeFacilityId(pathname: string, params: URLSearchParams): string | null {
  return params.get("facility") ?? pathname.match(/\/facilities\/([^/]+)/)?.[1] ?? null;
}

interface TreeNavContentProps {
  orgId: string;
  /** Called whenever a node link is clicked — used to close a mobile sheet on navigation. */
  onNavigate?: () => void;
}

/**
 * The sidebar's facility list, without the surrounding chrome (logo, org
 * name, width/border). Shared between the desktop <aside> (TreeNav) and the
 * mobile slide-over (MobileTreeSheet) so both present the same list and
 * active-state logic rather than maintaining two implementations.
 *
 * Deliberately flat. This was a three-level Facility > Department >
 * Schedule tree, which duplicated navigation that the command centre
 * already does better: departments and schedules are chip tiers there,
 * visible all at once and switchable without a page load. Keeping both
 * meant two ways to reach the same screen and a sidebar that grew unusably
 * tall for any real org. Picking a building here hands off to that page.
 */
export default function TreeNavContent({ orgId, onNavigate }: TreeNavContentProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading } = useNavTree(orgId);

  const activeFacility = activeFacilityId(
    pathname,
    new URLSearchParams(searchParams.toString())
  );

  // Schedule counts give the list the one piece of shape the tree used to
  // convey — how much lives in each building — without the nesting.
  const scheduleCountByFacility = useMemo(() => {
    const map = new Map<string, number>();
    for (const sg of data?.scheduleGroups ?? []) {
      map.set(sg.facility_id, (map.get(sg.facility_id) ?? 0) + 1);
    }
    return map;
  }, [data?.scheduleGroups]);

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-3" onClick={(e) => {
      if ((e.target as HTMLElement).closest("a")) onNavigate?.();
    }}>
      <div className="space-y-0.5">
        {topLinks.map((item) => {
          const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <TreeNavNode
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              depth={0}
              isActive={isActive}
            />
          );
        })}
      </div>

      <div>
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40">
            Facilities
          </span>
          <Link
            href="/dashboard/facilities/new"
            aria-label="Add facility"
            className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-accent-foreground"
          >
            <Plus className="size-3.5" />
          </Link>
        </div>

        {isLoading && (
          <div className="space-y-1.5 px-2 py-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-6 rounded bg-sidebar-accent/40 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && (data?.facilities.length ?? 0) === 0 && (
          <p className="px-3 py-2 text-xs text-sidebar-foreground/40">
            No facilities yet.
          </p>
        )}

        <div className="space-y-0.5">
          {data?.facilities.map((facility) => (
            <TreeNavNode
              key={facility.id}
              href={facilityRoute(facility.id)}
              label={facility.name}
              icon={Building2}
              depth={0}
              isActive={activeFacility === facility.id}
              isPublished={facility.is_published}
              badge={scheduleCountByFacility.get(facility.id) || undefined}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}
