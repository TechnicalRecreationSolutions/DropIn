"use client";

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import type { DemoScope } from "./heroWidgetSample";

/**
 * The hero widget's Facility / Department / Schedule pickers, in the header
 * bar's switcher row (ScheduleHeaderBar's `scopeControl`).
 *
 * They cascade: picking a facility lands on its first department, and a
 * department on its first schedule, so every combination on screen is one the
 * sample actually has. Facilities are grouped by name, not facilityId — the
 * community centre's gym, outdoor courts and studios are separate maps but
 * one building.
 */
export default function DemoScopeFilters({
  scopes,
  active,
  onChange,
  after,
}: {
  scopes: DemoScope[];
  active: DemoScope;
  onChange: (id: string) => void;
  /** Rendered at the end of the row — the hero's handwritten note. */
  after?: ReactNode;
}) {
  const facilities = unique(scopes.map((s) => s.facilityName));
  const inFacility = scopes.filter(
    (s) => s.facilityName === active.facilityName,
  );
  const departments = unique(inFacility.map((s) => s.departmentName));
  const inDepartment = inFacility.filter(
    (s) => s.departmentName === active.departmentName,
  );

  return (
    <div
      role="group"
      aria-label="Choose a schedule"
      // Phones: facility on its own row, department + schedule share the
      // next — the card is a fixed height and every row comes out of the view.
      className="grid grid-cols-2 gap-2 sm:flex sm:items-center"
    >
      <Picker
        label="Facility"
        className="col-span-2"
        value={active.facilityName}
        options={facilities.map((f) => ({ value: f, label: f }))}
        onChange={(f) => onChange(scopes.find((s) => s.facilityName === f)!.id)}
      />
      <Picker
        label="Department"
        value={active.departmentName}
        options={departments.map((d) => ({ value: d, label: d }))}
        onChange={(d) =>
          onChange(inFacility.find((s) => s.departmentName === d)!.id)
        }
      />
      <Picker
        label="Schedule"
        value={active.id}
        options={inDepartment.map((s) => ({ value: s.id, label: s.label }))}
        onChange={onChange}
      />
      {after}
    </div>
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function Picker({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-auto w-full min-w-0 gap-2 rounded-full border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground sm:w-fit sm:min-w-44 sm:text-sm",
          className,
        )}
      >
        {/* Children rather than the default derived text: see
            ScheduleScopeSwitcher for why SelectValue renders empty otherwise. */}
        <SelectValue>
          <span className="hidden text-muted-foreground sm:inline">
            {label}:{" "}
          </span>
          <span className="truncate">{current.label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
