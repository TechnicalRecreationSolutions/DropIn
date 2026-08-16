"use client";

import Link from "next/link";
import { Plus, EyeOff, Settings2, Layers, Calendar } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";
import type { CommandFacility, CommandScheduleGroup } from "./types";

interface ScopePickerProps {
  facility: CommandFacility;
  /** A real department id, NO_DEPARTMENT, or null for "every department". */
  departmentId: string | null;
  selectedSchedule: CommandScheduleGroup | null;
  /** Schedules visible under the current department filter. */
  visibleSchedules: CommandScheduleGroup[];
  onDepartmentChange: (departmentId: string | null) => void;
  onScheduleChange: (scheduleGroupId: string | null) => void;
  /** Edit form for the narrowest real thing in scope — schedule, else department, else facility. */
  settingsHref: string | null;
  settingsLabel: string;
}

/**
 * Narrows the building down to what's actually being worked on. Two tiers,
 * both chip rows rather than dropdowns: the scope is the most important
 * state on this page, so it stays readable at a glance and one tap away on
 * a phone instead of hidden behind a menu.
 *
 *   Departments   [ All ] [ Aquatics 3 ] [ Fitness 2 ] [ No department 1 ]
 *   Schedules     [ All ] [ Lap Swim ] [ Fun Swim ] [ + New ]
 *
 * The department tier only appears when the building actually has
 * departments — a facility that keeps its schedules flat never sees an
 * empty layer. Each tier is a real, useful scope in its own right: a
 * department shows everything running across it that week, which is the
 * view a department head wants, while placing sessions needs a single
 * schedule and so switches on one tier further down.
 */
export default function ScopePicker({
  facility,
  departmentId,
  selectedSchedule,
  visibleSchedules,
  onDepartmentChange,
  onScheduleChange,
  settingsHref,
  settingsLabel,
}: ScopePickerProps) {
  const hasDepartments = facility.departments.length > 0;
  const undepartmentedCount = facility.scheduleGroups.filter((g) => !g.departmentId).length;

  function scheduleCount(deptId: string | null) {
    return facility.scheduleGroups.filter((g) => (g.departmentId ?? null) === deptId).length;
  }

  // Where "+ New schedule" should create — inside the filtered department
  // when one is picked, so the new schedule lands in the scope you're in.
  const newScheduleHref =
    departmentId && departmentId !== NO_DEPARTMENT
      ? `/dashboard/facilities/${facility.id}/departments/${departmentId}/schedule-groups/new`
      : `/dashboard/facilities/${facility.id}/schedule-groups/new`;

  return (
    <div className="space-y-2">
      {hasDepartments && (
        <ChipRow label="Departments" icon={Layers}>
          <Chip active={departmentId === null} onClick={() => onDepartmentChange(null)}>
            All departments
          </Chip>
          {facility.departments.map((dept) => (
            <Chip
              key={dept.id}
              active={departmentId === dept.id}
              onClick={() => onDepartmentChange(dept.id)}
            >
              {dept.name}
              <Count active={departmentId === dept.id}>{scheduleCount(dept.id)}</Count>
            </Chip>
          ))}
          {undepartmentedCount > 0 && (
            <Chip
              active={departmentId === NO_DEPARTMENT}
              onClick={() => onDepartmentChange(NO_DEPARTMENT)}
            >
              No department
              <Count active={departmentId === NO_DEPARTMENT}>{undepartmentedCount}</Count>
            </Chip>
          )}
          <NewLink href={`/dashboard/facilities/${facility.id}/departments/new`}>
            New department
          </NewLink>
        </ChipRow>
      )}

      <ChipRow
        label="Schedules"
        icon={Calendar}
        showLabel={hasDepartments}
        trailing={
          settingsHref && (
            <Link
              href={settingsHref}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition-colors"
              title={`Settings for ${settingsLabel}`}
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
          )
        }
      >
        <Chip active={selectedSchedule === null} onClick={() => onScheduleChange(null)}>
          All schedules
        </Chip>

        {visibleSchedules.map((group) => (
          <Chip
            key={group.id}
            active={selectedSchedule?.id === group.id}
            onClick={() => onScheduleChange(group.id)}
          >
            {group.name}
            {group.status !== "published" && <EyeOff className="w-3 h-3 opacity-70" aria-label="Draft" />}
          </Chip>
        ))}

        <NewLink href={newScheduleHref}>New schedule</NewLink>
      </ChipRow>
    </div>
  );
}

function ChipRow({
  label,
  icon: Icon,
  showLabel = true,
  trailing,
  children,
}: {
  label: string;
  icon: typeof Layers;
  showLabel?: boolean;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {showLabel && (
        <span className="hidden lg:flex items-center gap-1.5 shrink-0 w-28 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </span>
      )}
      <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto pb-1">{children}</div>
      {trailing}
    </div>
  );
}

/** Dashed "create" affordance sitting at the end of a chip row. */
function NewLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-dashed border-gray-300 text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors"
    >
      <Plus className="w-3.5 h-3.5" />
      {children}
    </Link>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors max-w-[16rem] truncate",
        active ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      )}
      style={active ? { backgroundColor: "var(--org-primary, #2563eb)" } : undefined}
    >
      {children}
    </button>
  );
}

function Count({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-bold",
        active ? "bg-white/25 text-white" : "bg-white text-gray-500"
      )}
    >
      {children}
    </span>
  );
}
