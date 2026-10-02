"use client";

import { useId } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import TickBoxDropdown from "@/components/schedule/TickBoxDropdown";
import type { NavTreeDepartment, NavTreeFacility, NavTreeScheduleGroup } from "@/hooks/useNavTree";
import { cn } from "@/lib/utils/cn";

/** The switcher's value for "All facilities" — never a URL value (that is a missing `?facility`). */
export const ALL_FACILITIES = "__all__";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The building switcher: the one place in the dashboard a facility is chosen.
 *
 * The widget's filter control (TickBoxDropdown) on the app's tokens — label
 * "Facility" above a field holding the building's name, opening the widget's
 * tick-box list with a muted "2 departments · 1 schedule" under each name. A
 * building is always ticked, except where the page has a meaning for "All
 * facilities" (`offerAll`): there, as in the widget, nothing ticked is "All".
 *
 * Renders nothing when there is only one building to be in — single-building
 * organizations, and most coordinators and aux staff — except the "add one"
 * prompt when there are none at all.
 *
 * `orgWide` is set on pages that do not read the building (Facilities,
 * Settings, Widget …). The switcher still shows, so the sidebar does not jump
 * between pages, but it says plainly that this page covers every building
 * rather than pretending to filter it.
 */
export default function FacilitySwitcher({
  facilities,
  departments,
  scheduleGroups,
  value,
  onChange,
  offerAll = false,
  orgWide = false,
  collapsed = false,
}: {
  facilities: NavTreeFacility[];
  departments: NavTreeDepartment[];
  scheduleGroups: NavTreeScheduleGroup[];
  /** A facility id, or ALL_FACILITIES. */
  value: string | null;
  onChange: (value: string) => void;
  offerAll?: boolean;
  orgWide?: boolean;
  collapsed?: boolean;
}) {
  // The desktop sidebar and the phone sheet can both be mounted.
  const id = `facility-switcher${useId()}`;

  if (facilities.length === 0) {
    if (collapsed) return null;
    return (
      <div className="px-4 pb-3">
        <p className="text-caption text-muted-foreground mb-1">No facilities yet.</p>
        <Link
          href="/dashboard/facilities/new"
          className="inline-flex items-center gap-1.5 rounded-sm text-caption font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" /> Add a facility
        </Link>
      </div>
    );
  }
  if (facilities.length < 2) return null;

  const items = [
    ...facilities.map((f) => ({
      value: f.id,
      label: f.name,
      detail: `${count(departments.filter((d) => d.facility_id === f.id).length, "department")} · ${count(
        scheduleGroups.filter((g) => g.facility_id === f.id).length,
        "schedule"
      )}`,
    })),
  ];
  const selected = items.some((i) => i.value === value) ? [value as string] : [];
  // Said under the field when expanded; inside the list when there is no room.
  const footer = orgWide && collapsed ? "This page covers every facility." : undefined;

  return (
    <div className={cn(collapsed ? "flex justify-center px-2 pb-2" : "px-4 pb-3")}>
      <TickBoxDropdown
        id={id}
        label="Facility"
        allLabel={offerAll ? "All facilities" : "Choose a facility"}
        items={items}
        selected={selected}
        // Where "All facilities" exists it is nothing ticked, as in the
        // widget; elsewhere a building is always ticked.
        onChange={(next) => (next[0] ? onChange(next[0]) : offerAll && onChange(ALL_FACILITIES))}
        theme="app"
        mode={offerAll ? "single" : "radio"}
        stackDetail
        trigger={collapsed ? "icon" : "field"}
        icon={Building2}
        footer={footer}
        className="w-full"
        // 44px on phones (the sheet), the field's 40px in the desktop sidebar.
        buttonClassName={collapsed ? undefined : "h-11 lg:h-10"}
        // As wide as the longest name needs (over the page if it must), so
        // the "2 departments · 1 schedule" line is never cut off.
        panelClassName={collapsed ? "top-0 left-full mt-0 ml-2 w-64" : "w-max min-w-full max-w-80"}
      />
      {orgWide && !collapsed && (
        <p className="mt-1.5 text-caption text-muted-foreground">This page covers every facility.</p>
      )}
    </div>
  );
}
