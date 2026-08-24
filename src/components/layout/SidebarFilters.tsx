"use client";

import Link from "next/link";
import { Building2, Layers, CalendarDays, Plus, type LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";
import type { NavTreeDepartment, NavTreeFacility, NavTreeScheduleGroup } from "@/hooks/useNavTree";
import type { SidebarSelection } from "./SidebarNav";

/** Sentinel select value for "no filter applied at this tier". */
const ALL = "__all__";

interface SidebarFiltersProps {
  /** Every facility in the org — used for the top-level picker. */
  facilities: NavTreeFacility[];
  /** Already scoped to the selected facility. */
  departments: NavTreeDepartment[];
  /** Already scoped to the selected facility (not yet scoped to department — this component narrows further for display). */
  scheduleGroups: NavTreeScheduleGroup[];
  selection: SidebarSelection;
  onChange: (next: SidebarSelection) => void;
}

/**
 * The mockup's Facility/Department/Schedule dropdown filters. This replaces
 * the old accordion tree as the primary way to narrow scope — the flat Menu
 * below builds its links from whatever is selected here.
 */
export default function SidebarFilters({
  facilities,
  departments,
  scheduleGroups,
  selection,
  onChange,
}: SidebarFiltersProps) {
  if (facilities.length === 0) {
    return (
      <div className="px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40 mb-2">
          Filters
        </p>
        <p className="text-xs text-sidebar-foreground/50 mb-2">No facilities yet.</p>
        <Link
          href="/dashboard/facilities/new"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-sidebar-primary hover:underline"
        >
          <Plus className="size-3.5" /> Add a facility
        </Link>
      </div>
    );
  }

  const hasDepartments = departments.length > 0;

  const visibleSchedules = scheduleGroups.filter((g) => {
    if (!hasDepartments || selection.departmentId === null) return true;
    if (selection.departmentId === NO_DEPARTMENT) return !g.department_id;
    return g.department_id === selection.departmentId;
  });

  return (
    <div className="px-4 py-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40 px-0.5">
        Filters
      </p>

      <FilterSelect
        icon={Building2}
        value={selection.facilityId ?? undefined}
        placeholder="Facility"
        onValueChange={(facilityId) =>
          onChange({ facilityId, departmentId: null, scheduleGroupId: null })
        }
      >
        {facilities.map((f) => (
          <SelectItem key={f.id} value={f.id}>
            {f.name}
          </SelectItem>
        ))}
      </FilterSelect>

      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <FilterSelect
            icon={Layers}
            value={hasDepartments ? (selection.departmentId ?? ALL) : ALL}
            placeholder="No departments"
            disabled={!hasDepartments}
            onValueChange={(value) =>
              onChange({ ...selection, departmentId: value === ALL ? null : value, scheduleGroupId: null })
            }
          >
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
            {scheduleGroups.some((g) => !g.department_id) && (
              <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
            )}
          </FilterSelect>
        </div>
        {/* The only entry point left for adding a department now that the
            schedule page's chip-row pickers (which used to offer "+ New
            department") are gone. */}
        <Link
          href="/dashboard/departments/new"
          title="Add a department"
          className="shrink-0 inline-flex items-center justify-center size-8 rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Plus className="size-3.5" />
        </Link>
      </div>

      <FilterSelect
        icon={CalendarDays}
        value={selection.scheduleGroupId ?? ALL}
        placeholder="Schedule"
        disabled={visibleSchedules.length === 0}
        onValueChange={(value) =>
          onChange({ ...selection, scheduleGroupId: value === ALL ? null : value })
        }
      >
        <SelectItem value={ALL}>All schedules</SelectItem>
        {visibleSchedules.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.name}
          </SelectItem>
        ))}
      </FilterSelect>
    </div>
  );
}

function FilterSelect({
  icon: Icon,
  value,
  placeholder,
  disabled,
  onValueChange,
  children,
}: {
  icon: LucideIcon;
  value: string | undefined;
  placeholder: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="w-full bg-sidebar-accent/40 border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent data-placeholder:text-sidebar-foreground/50 [&_svg:not([class*='text-'])]:text-sidebar-foreground/50">
        <Icon className="size-3.5 text-sidebar-foreground/50 shrink-0" />
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
