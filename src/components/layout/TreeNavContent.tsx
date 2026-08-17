"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Building2,
  LayoutDashboard,
  Database,
  CreditCard,
  Plus,
  Settings,
  Layers,
  CalendarDays,
  DoorOpen,
  Map as MapIcon,
  MonitorSmartphone,
} from "lucide-react";
import { useNavTree, type NavTreeDepartment, type NavTreeScheduleGroup } from "@/hooks/useNavTree";
import { commandCentreHref, NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";
import TreeNavNode from "./TreeNavNode";

export const topLinks = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
];

export const bottomLinks = [
  { href: "/dashboard/data-sources", label: "Data Sources", icon: Database },
  // Above Billing because it's the one a new centre needs on day one — the
  // org name and logo it edits here are what the public pages render.
  { href: "/dashboard/settings", label: "Organization", icon: Settings },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

/**
 * A facility's home — the Overview page scoped to that building, where the
 * schedule list (current/active + stored) lives. Distinct from
 * `commandCentreHref`, which opens the building/schedule *editor*: clicking
 * a facility in the tree means "show me what's here", clicking a schedule
 * leaf under it means "let me edit that one".
 */
function facilityOverviewHref(facilityId: string) {
  return `/dashboard?facility=${facilityId}`;
}

/** Which facility a route is "inside", from the query string or the (redirect-only) legacy path. */
function activeFacilityId(pathname: string, params: URLSearchParams): string | null {
  return params.get("facility") ?? pathname.match(/\/facilities\/([^/]+)/)?.[1] ?? null;
}

interface TreeNavContentProps {
  orgId: string;
  /** Called whenever a node link is clicked — used to close a mobile sheet on navigation. */
  onNavigate?: () => void;
}

/**
 * The sidebar's Facility > Department > Schedule tree, plus each facility's
 * Spaces/Map/Widget settings pages. Shared between the desktop <aside>
 * (TreeNav) and the mobile slide-over (MobileTreeSheet) so both present the
 * same tree and active-state logic rather than maintaining two
 * implementations.
 *
 * This *is* the three-level tree an earlier pass deliberately flattened
 * (see git history on this file, commit e82df5d) — that flattening's own
 * complaint was a sidebar that stayed unusably tall for any real org, from
 * showing every building's full tree at once. The accordion here avoids
 * that the same way the command centre's own chips did: only one facility's
 * tree is ever expanded, so height is bounded by one building's schedules,
 * not the whole org's. It coexists with the command centre's ScopePicker
 * chips rather than replacing them — this is the persistent, always-visible
 * way to jump anywhere; the chips are the fast in-page way to pivot without
 * touching the sidebar, which matters most on mobile where this tree lives
 * behind a sheet.
 */
export default function TreeNavContent({ orgId, onNavigate }: TreeNavContentProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading } = useNavTree(orgId);
  const onCommandCentre = pathname.startsWith("/dashboard/schedule");

  const activeFacility = activeFacilityId(
    pathname,
    new URLSearchParams(searchParams.toString())
  );
  const activeDepartment = onCommandCentre ? searchParams.get("department") : null;
  const activeSchedule = onCommandCentre ? searchParams.get("schedule") : null;
  const activeTab = onCommandCentre ? (searchParams.get("tab") ?? "schedule") : null;

  // Schedule counts give the collapsed row the one piece of shape it needs
  // without opening the tree — how much lives in each building.
  const scheduleCountByFacility = useMemo(() => {
    const map = new Map<string, number>();
    for (const sg of data?.scheduleGroups ?? []) {
      map.set(sg.facility_id, (map.get(sg.facility_id) ?? 0) + 1);
    }
    return map;
  }, [data?.scheduleGroups]);

  // Accordion: exactly one facility open at a time. Forced open whenever the
  // URL names one explicitly (arriving via a schedule/command-centre link);
  // otherwise left to whatever the user last clicked, defaulting to the
  // first facility once the tree loads.
  const [expandedFacilityId, setExpandedFacilityId] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeFacility) setExpandedFacilityId(activeFacility);
  }, [activeFacility]);
  useEffect(() => {
    if (!expandedFacilityId && data?.facilities.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpandedFacilityId(activeFacility ?? data.facilities[0].id);
    }
  }, [data, activeFacility, expandedFacilityId]);

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
          {data?.facilities.map((facility) => {
            const expanded = expandedFacilityId === facility.id;
            return (
              <div key={facility.id}>
                <TreeNavNode
                  href={facilityOverviewHref(facility.id)}
                  label={facility.name}
                  icon={Building2}
                  depth={0}
                  isActive={activeFacility === facility.id && !onCommandCentre}
                  isPublished={facility.is_published}
                  badge={scheduleCountByFacility.get(facility.id) || undefined}
                  expandable
                  expanded={expanded}
                  onToggleExpand={() =>
                    setExpandedFacilityId(expanded ? null : facility.id)
                  }
                />
                {expanded && (
                  <FacilityBranch
                    facilityId={facility.id}
                    departments={(data?.departments ?? []).filter(
                      (d) => d.facility_id === facility.id
                    )}
                    scheduleGroups={(data?.scheduleGroups ?? []).filter(
                      (g) => g.facility_id === facility.id
                    )}
                    activeDepartment={activeDepartment}
                    activeSchedule={activeSchedule}
                    activeTab={activeFacility === facility.id ? activeTab : null}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

interface FacilityBranchProps {
  facilityId: string;
  departments: NavTreeDepartment[];
  scheduleGroups: NavTreeScheduleGroup[];
  activeDepartment: string | null;
  activeSchedule: string | null;
  /** Only set when this facility is the one the URL actually names. */
  activeTab: string | null;
}

/**
 * A building's expanded contents: its schedules (grouped by department when
 * it has any) followed by its Spaces/Map/Widget settings pages. Schedules
 * with no department sit in a "No department" bucket rather than being
 * hidden — the same NO_DEPARTMENT sentinel the command centre's own
 * ScopePicker uses, so the two stay consistent about what that state means.
 */
function FacilityBranch({
  facilityId,
  departments,
  scheduleGroups,
  activeDepartment,
  activeSchedule,
  activeTab,
}: FacilityBranchProps) {
  const hasDepartments = departments.length > 0;
  const undepartmented = scheduleGroups.filter((g) => !g.department_id);

  function scheduleNode(group: NavTreeScheduleGroup, depth: number) {
    return (
      <TreeNavNode
        key={group.id}
        href={commandCentreHref({
          facilityId,
          departmentId: group.department_id ?? NO_DEPARTMENT,
          scheduleGroupId: group.id,
        })}
        label={group.name}
        icon={CalendarDays}
        depth={depth}
        isActive={activeSchedule === group.id}
        isPublished={group.status === "published"}
      />
    );
  }

  return (
    <div className="space-y-0.5">
      {hasDepartments ? (
        <>
          {departments.map((dept) => {
            const deptSchedules = scheduleGroups.filter((g) => g.department_id === dept.id);
            return (
              <div key={dept.id}>
                <TreeNavNode
                  href={commandCentreHref({ facilityId, departmentId: dept.id })}
                  label={dept.name}
                  icon={Layers}
                  depth={1}
                  isActive={activeDepartment === dept.id}
                  isPublished={dept.is_published}
                  badge={deptSchedules.length || undefined}
                />
                {deptSchedules.map((g) => scheduleNode(g, 2))}
              </div>
            );
          })}
          {undepartmented.length > 0 && (
            <div>
              <TreeNavNode
                href={commandCentreHref({ facilityId, departmentId: NO_DEPARTMENT })}
                label="No department"
                icon={Layers}
                depth={1}
                isActive={activeDepartment === NO_DEPARTMENT}
                badge={undepartmented.length}
              />
              {undepartmented.map((g) => scheduleNode(g, 2))}
            </div>
          )}
        </>
      ) : (
        scheduleGroups.map((g) => scheduleNode(g, 1))
      )}

      {scheduleGroups.length === 0 && (
        <p className="px-3 py-1 text-xs text-sidebar-foreground/40" style={{ paddingLeft: 22 }}>
          No schedules yet.
        </p>
      )}

      <div className="pt-0.5 space-y-0.5">
        <TreeNavNode
          href={commandCentreHref({ facilityId, tab: "spaces" })}
          label="Spaces"
          icon={DoorOpen}
          depth={1}
          isActive={activeTab === "spaces"}
        />
        <TreeNavNode
          href={commandCentreHref({ facilityId, tab: "map" })}
          label="Map"
          icon={MapIcon}
          depth={1}
          isActive={activeTab === "map"}
        />
        <TreeNavNode
          href={commandCentreHref({ facilityId, tab: "widget" })}
          label="Widget"
          icon={MonitorSmartphone}
          depth={1}
          isActive={activeTab === "widget"}
        />
      </div>
    </div>
  );
}
