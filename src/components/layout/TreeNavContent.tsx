"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Layers,
  Calendar,
  LayoutDashboard,
  Database,
  CreditCard,
  Plus,
} from "lucide-react";
import { useNavTree, type NavTreeDepartment, type NavTreeScheduleGroup } from "@/hooks/useNavTree";
import TreeNavNode from "./TreeNavNode";

export const topLinks = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
];

export const bottomLinks = [
  { href: "/dashboard/data-sources", label: "Data Sources", icon: Database },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export function facilityRoute(facilityId: string) {
  return `/dashboard/facilities/${facilityId}`;
}
export function departmentRoute(facilityId: string, departmentId: string) {
  return `/dashboard/facilities/${facilityId}/departments/${departmentId}`;
}
export function scheduleGroupRoute(sg: NavTreeScheduleGroup) {
  return sg.department_id
    ? `/dashboard/facilities/${sg.facility_id}/departments/${sg.department_id}/schedule-groups/${sg.id}`
    : `/dashboard/facilities/${sg.facility_id}/schedule-groups/${sg.id}`;
}

/** Derives which facility/department ids should start expanded from the current URL. */
function ancestorsFromPathname(pathname: string): Set<string> {
  const ids = new Set<string>();
  const facilityMatch = pathname.match(/\/facilities\/([^/]+)/);
  const departmentMatch = pathname.match(/\/departments\/([^/]+)/);
  if (facilityMatch) ids.add(facilityMatch[1]);
  if (departmentMatch) ids.add(departmentMatch[1]);
  return ids;
}

interface TreeNavContentProps {
  orgId: string;
  /** Called whenever a node link is clicked — used to close a mobile sheet on navigation. */
  onNavigate?: () => void;
}

/**
 * The Facility > Department > Schedule Group tree itself, without the
 * surrounding sidebar chrome (logo, org name, width/border). Shared between
 * the desktop <aside> (TreeNav) and the mobile slide-over (MobileTreeSheet)
 * so both present the exact same hierarchy, expand/collapse, and active-state
 * logic rather than maintaining two independent tree implementations.
 */
export default function TreeNavContent({ orgId, onNavigate }: TreeNavContentProps) {
  const pathname = usePathname();
  const { data, isLoading } = useNavTree(orgId);
  // Nodes the user has manually expanded or collapsed via the chevron.
  const [manuallyToggled, setManuallyToggled] = useState<Map<string, boolean>>(new Map());
  // The effective expanded set: ancestors of the current route are always
  // expanded (so client-side navigation between facilities/departments keeps
  // the tree in sync with the page you're on — this component lives in the
  // persistent layout and never remounts), overlaid with anything the user
  // has manually toggled since. Recomputed on every pathname change, not
  // just on mount.
  const expanded = useMemo(() => {
    const next = new Set(ancestorsFromPathname(pathname));
    for (const [id, isOpen] of manuallyToggled) {
      if (isOpen) next.add(id);
      else next.delete(id);
    }
    return next;
  }, [pathname, manuallyToggled]);

  const departmentsByFacility = useMemo(() => {
    const map = new Map<string, NavTreeDepartment[]>();
    for (const d of data?.departments ?? []) {
      const list = map.get(d.facility_id) ?? [];
      list.push(d);
      map.set(d.facility_id, list);
    }
    return map;
  }, [data?.departments]);

  const scheduleGroupsByDepartment = useMemo(() => {
    const map = new Map<string, NavTreeScheduleGroup[]>();
    for (const sg of data?.scheduleGroups ?? []) {
      if (!sg.department_id) continue;
      const list = map.get(sg.department_id) ?? [];
      list.push(sg);
      map.set(sg.department_id, list);
    }
    return map;
  }, [data?.scheduleGroups]);

  const ungroupedScheduleGroupsByFacility = useMemo(() => {
    const map = new Map<string, NavTreeScheduleGroup[]>();
    for (const sg of data?.scheduleGroups ?? []) {
      if (sg.department_id) continue;
      const list = map.get(sg.facility_id) ?? [];
      list.push(sg);
      map.set(sg.facility_id, list);
    }
    return map;
  }, [data?.scheduleGroups]);

  function toggle(id: string) {
    setManuallyToggled((prev) => {
      const next = new Map(prev);
      next.set(id, !expanded.has(id));
      return next;
    });
  }

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
            const isFacilityExpanded = expanded.has(facility.id);
            const departments = departmentsByFacility.get(facility.id) ?? [];
            const ungrouped = ungroupedScheduleGroupsByFacility.get(facility.id) ?? [];
            const hasChildren = departments.length > 0 || ungrouped.length > 0;

            return (
              <div key={facility.id}>
                <TreeNavNode
                  href={facilityRoute(facility.id)}
                  label={facility.name}
                  icon={Building2}
                  depth={0}
                  isActive={pathname === facilityRoute(facility.id)}
                  isPublished={facility.is_published}
                  hasChildren={hasChildren}
                  isExpanded={isFacilityExpanded}
                  onToggle={() => toggle(facility.id)}
                />

                {isFacilityExpanded && (
                  <div>
                    {departments.map((dept) => {
                      const isDeptExpanded = expanded.has(dept.id);
                      const schedules = scheduleGroupsByDepartment.get(dept.id) ?? [];

                      return (
                        <div key={dept.id}>
                          <TreeNavNode
                            href={departmentRoute(facility.id, dept.id)}
                            label={dept.name}
                            icon={Layers}
                            depth={1}
                            isActive={pathname === departmentRoute(facility.id, dept.id)}
                            isPublished={dept.is_published}
                            hasChildren={schedules.length > 0}
                            isExpanded={isDeptExpanded}
                            onToggle={() => toggle(dept.id)}
                          />
                          {isDeptExpanded &&
                            schedules.map((sg) => (
                              <TreeNavNode
                                key={sg.id}
                                href={scheduleGroupRoute(sg)}
                                label={sg.name}
                                icon={Calendar}
                                depth={2}
                                isActive={pathname === scheduleGroupRoute(sg)}
                                isPublished={sg.is_published}
                              />
                            ))}
                        </div>
                      );
                    })}

                    {ungrouped.map((sg) => (
                      <TreeNavNode
                        key={sg.id}
                        href={scheduleGroupRoute(sg)}
                        label={sg.name}
                        icon={Calendar}
                        depth={1}
                        isActive={pathname === scheduleGroupRoute(sg)}
                        isPublished={sg.is_published}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
