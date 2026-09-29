"use client";

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { LocalScope, WidgetFacility } from "./types";

interface FilterEditorProps {
  rows: LocalScope[];
  facilities: WidgetFacility[];
  primaryColor: string;
  disabled?: boolean;
  onAdd: () => void;
  /** Seeds one row per facility — the two-to-four-facility case this feature exists for. */
  onAddPerFacility: () => void;
  onChange: (key: string, patch: Partial<LocalScope>) => void;
  onRemove: (key: string) => void;
  onMove: (key: string, direction: -1 | 1) => void;
}

interface DepartmentOption {
  id: string;
  name: string;
  is_published: boolean;
}
interface ScheduleGroupOption {
  id: string;
  name: string;
  department_id: string | null;
  status: string;
}

/** What a row resolves to once its pickers are filled in. */
interface RowResolution {
  /** Deepest chosen level's name — the natural default label. */
  suggestedLabel: string;
  /** "Aquatic Centre › Aquatics › Lane Swim". */
  breadcrumb: string;
  /** Levels that are chosen but not published — why visitors won't see this row. */
  unpublished: string[];
}

/**
 * Step 1, whole: the list of schedules the embed publishes.
 *
 * There used to be two controls here — a row of facility/department tiles that
 * addressed a `widget_configs` row, and this list — and they answered the same
 * question with different answers, since `WidgetScheduleClient` renders the
 * selected *entry's* facility and department and ignores the config's the
 * moment the list has anything in it. Migration 045 collapsed settings to one
 * row per org, which leaves this list as the only thing saying what an embed
 * shows: empty is everything the org runs, one entry is that schedule, two or
 * more give visitors a switcher. Narrowing a single copy of the code to one
 * facility is a snippet option in step 4, not a second saved configuration.
 *
 * The list is the editor. Each row collapses to one line — its label, where it
 * points, and whether visitors can actually see it — and opens to the three
 * pickers only while you are changing it, so an org with four facilities reads
 * four lines instead of four tall forms. Rows that are still local (`new-`
 * keys, i.e. added since the last publish) and rows with no facility yet open
 * themselves, because those are the ones with something left to fill in.
 *
 * There is deliberately no mock of the widget here. This card used to open
 * with a rendered `ScheduleScopeSwitcher` in the brand colour, which cost a
 * screenful before the first control and duplicated the real preview window
 * one click away in the header — the switcher it drew was also the *only*
 * thing it could draw, so it went stale against every other setting.
 *
 * The other half of the job is telling the truth about visibility: migration
 * 043's public read policy hides any scope whose facility, department or
 * schedule is not published, so a filter can save with a 200, sit in this list
 * forever, and never once appear on the website. Every row that would vanish
 * says so on its collapsed line, and names the level to fix.
 *
 * Departments and schedules are fetched here, once per referenced facility,
 * rather than inside each row: the collapsed lines need every row's resolved
 * names too, and a child reporting them back up to a parent that renders them
 * is a render-phase state write.
 */
export default function FilterEditor({
  rows,
  facilities,
  primaryColor,
  disabled,
  onAdd,
  onAddPerFacility,
  onChange,
  onRemove,
  onMove,
}: FilterEditorProps) {
  /** Explicit open/closed, per row — overrides the default below when set. */
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});

  const facilityIds = useMemo(
    () => [...new Set(rows.map((r) => r.facilityId).filter(Boolean))],
    [rows]
  );

  const departmentQueries = useQueries({
    queries: facilityIds.map((facilityId) => ({
      queryKey: ["widget-scope-departments", facilityId],
      queryFn: async () => {
        const res = await fetch(`/api/departments?facilityId=${facilityId}`);
        if (!res.ok) throw new Error(`Failed to load departments (${res.status})`);
        const data = await res.json();
        return (data.departments ?? []) as DepartmentOption[];
      },
    })),
  });

  const scheduleQueries = useQueries({
    queries: facilityIds.map((facilityId) => ({
      queryKey: ["widget-scope-schedule-groups", facilityId],
      queryFn: async () => {
        const res = await fetch(`/api/schedule-groups?facilityId=${facilityId}`);
        if (!res.ok) throw new Error(`Failed to load schedules (${res.status})`);
        const data = await res.json();
        return (data.scheduleGroups ?? []) as ScheduleGroupOption[];
      },
    })),
  });

  const departmentsFor = (facilityId: string): DepartmentOption[] => {
    const i = facilityIds.indexOf(facilityId);
    return i < 0 ? [] : departmentQueries[i]?.data ?? [];
  };
  // A schedule's own department decides its home once a schedule is picked — so
  // only offer schedules that actually sit under the chosen department (or,
  // with no department chosen, every schedule in the facility).
  const schedulesFor = (facilityId: string, departmentId: string): ScheduleGroupOption[] => {
    const i = facilityIds.indexOf(facilityId);
    const all = i < 0 ? [] : scheduleQueries[i]?.data ?? [];
    return all.filter((sg) => !departmentId || sg.department_id === departmentId);
  };

  function resolve(row: LocalScope): RowResolution {
    const facility = facilities.find((f) => f.id === row.facilityId);
    const department = departmentsFor(row.facilityId).find((d) => d.id === row.departmentId);
    const schedule = schedulesFor(row.facilityId, row.departmentId).find(
      (sg) => sg.id === row.scheduleGroupId
    );

    const unpublished: string[] = [];
    if (facility && !facility.isPublished) unpublished.push(`${facility.name} (facility)`);
    if (department && !department.is_published) unpublished.push(`${department.name} (department)`);
    if (schedule && schedule.status !== "published") unpublished.push(`${schedule.name} (schedule)`);

    const names = [facility?.name, department?.name, schedule?.name].filter((n): n is string => !!n);
    return {
      suggestedLabel: names[names.length - 1] ?? "",
      breadcrumb: names.join(" › "),
      unpublished,
    };
  }

  const resolved = rows.map((row) => ({ row, resolution: resolve(row) }));
  const filled = resolved.filter(({ row }) => !!row.facilityId);
  const hiddenCount = filled.filter(({ resolution }) => resolution.unpublished.length > 0).length;
  const visibleCount = filled.length - hiddenCount;

  const labelFor = (row: LocalScope, resolution: RowResolution) =>
    row.label.trim() || resolution.suggestedLabel || "Schedule";

  /** Unfinished and not-yet-published rows start open; everything else starts as a line. */
  const isOpen = (row: LocalScope) =>
    openOverrides[row.key] ?? (!row.facilityId || row.key.startsWith("new-"));

  const setOpen = (key: string, open: boolean) =>
    setOpenOverrides((prev) => ({ ...prev, [key]: open }));

  const accent = /^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : "#0066CC";

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border px-6 py-10 text-center">
        <h3 className="text-body font-medium text-foreground">
          Showing everything you run
        </h3>
        <p className="mt-1 text-caption text-muted-foreground max-w-md mx-auto">
          Add a facility or department to narrow it, or several to give visitors a switcher.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" onClick={onAdd} disabled={disabled}>
            <Plus />
            Add a schedule
          </Button>
          {facilities.length > 1 && (
            <Button type="button" variant="ghost" onClick={onAddPerFacility} disabled={disabled}>
              One per facility ({facilities.length})
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="rounded-card border border-border overflow-hidden divide-y divide-border">
        {resolved.map(({ row, resolution }, index) => (
          <FilterRow
            key={row.key}
            row={row}
            index={index}
            total={rows.length}
            accent={accent}
            resolution={resolution}
            label={labelFor(row, resolution)}
            open={isOpen(row)}
            onToggle={() => setOpen(row.key, !isOpen(row))}
            facilities={facilities}
            departments={departmentsFor(row.facilityId)}
            schedules={schedulesFor(row.facilityId, row.departmentId)}
            disabled={disabled}
            onChange={(patch) => onChange(row.key, patch)}
            onRemove={() => onRemove(row.key)}
            onMove={(dir) => onMove(row.key, dir)}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={disabled}>
          <Plus />
          Add a schedule
        </Button>
        {facilities.length > 1 && (
          <Button type="button" variant="ghost" size="sm" onClick={onAddPerFacility} disabled={disabled}>
            One per facility ({facilities.length})
          </Button>
        )}
      </div>

      <p className="text-caption text-muted-foreground">
        {filled.length === 0
          ? "Nothing filled in yet, so the widget shows everything you run."
          : filled.length === 1
            ? "One entry: the widget shows exactly this, with no switcher."
            : `Visitors switch between ${visibleCount} of these ${filled.length}, in this order.`}
        {hiddenCount > 0 &&
          ` ${hiddenCount === 1 ? "One is" : `${hiddenCount} are`} hidden until what ${
            hiddenCount === 1 ? "it points" : "they point"
          } at is published.`}
      </p>
    </div>
  );
}

function FilterRow({
  row,
  index,
  total,
  accent,
  resolution,
  label,
  open,
  onToggle,
  facilities,
  departments,
  schedules,
  disabled,
  onChange,
  onRemove,
  onMove,
}: {
  row: LocalScope;
  index: number;
  total: number;
  accent: string;
  resolution: RowResolution;
  label: string;
  open: boolean;
  onToggle: () => void;
  facilities: WidgetFacility[];
  departments: DepartmentOption[];
  schedules: ScheduleGroupOption[];
  disabled?: boolean;
  onChange: (patch: Partial<LocalScope>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const hidden = resolution.unpublished.length > 0;
  const incomplete = !row.facilityId;

  return (
    <li
      className={cn(
        "relative bg-card transition-colors",
        open ? "bg-muted/50" : "hover:bg-muted"
      )}
    >
      {/* Brand-coloured edge: the one visual tie between a row and the pill it
          becomes in the widget, without drawing a fake widget. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: incomplete ? "transparent" : accent }}
      />

      <div className="flex items-center gap-1 pl-3 pr-1.5 py-2">
        {/* Order controls double as the row number. */}
        <div className="flex flex-col shrink-0 -my-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
            title="Move up"
            aria-label={`Move ${label} up`}
            className="p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-25 disabled:hover:bg-transparent"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={disabled || index === total - 1}
            title="Move down"
            aria-label={`Move ${label} down`}
            className="p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-25 disabled:hover:bg-transparent"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={incomplete ? `Edit unfinished entry ${index + 1}` : `Edit ${label}`}
          // focus-visible, not focus: a mouse click on a row would otherwise
          // leave a ring around it that reads as a text field.
          className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 flex-wrap">
              <span
                className={cn(
                  "text-sm font-medium truncate",
                  incomplete ? "text-muted-foreground italic" : "text-foreground"
                )}
              >
                {incomplete ? "Unfinished entry" : label}
              </span>
              {hidden && (
                <Badge variant="warning">
                  <AlertTriangle />
                  Hidden
                </Badge>
              )}
            </span>
            <span className="block text-label font-normal text-muted-foreground truncate">
              {incomplete ? "Pick a facility — this is dropped when you publish" : resolution.breadcrumb}
            </span>
          </span>
          <Pencil
            className={cn(
              "w-3.5 h-3.5 shrink-0 transition-colors",
              open ? "text-brand" : "text-muted-foreground"
            )}
          />
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={disabled}
          title="Remove"
          aria-label={`Remove ${label}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>

      {open && (
        // Indented to the row's own title, so an open row reads as that row's
        // detail rather than as a panel the whole list dropped down.
        <div className="pl-4 sm:pl-10 pr-3 pb-3 space-y-2.5">
          <label className="block">
            <span className="block text-label text-muted-foreground mb-1">
              What visitors see on the button
            </span>
            <Input
              type="text"
              value={row.label}
              onChange={(e) => onChange({ label: e.target.value })}
              // Follows the deepest selection, so picking "Lane Swim" offers
              // "Lane Swim" rather than the facility's name.
              placeholder={resolution.suggestedLabel || "e.g. Pool"}
              aria-label={`Label for schedule ${index + 1}`}
              className="font-medium"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="block">
              <span className="block text-label text-muted-foreground mb-1">
                Facility
              </span>
              <NativeSelect
                value={row.facilityId}
                onChange={(e) =>
                  onChange({ facilityId: e.target.value, departmentId: "", scheduleGroupId: "" })
                }
                disabled={disabled}
              >
                <option value="">Choose a facility…</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.isPublished ? "" : " — draft"}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="block">
              <span className="block text-label text-muted-foreground mb-1">
                Department
              </span>
              <NativeSelect
                value={row.departmentId}
                onChange={(e) => onChange({ departmentId: e.target.value, scheduleGroupId: "" })}
                disabled={disabled || !row.facilityId || departments.length === 0}
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.is_published ? "" : " — draft"}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="block">
              <span className="block text-label text-muted-foreground mb-1">
                Schedule
              </span>
              <NativeSelect
                value={row.scheduleGroupId}
                onChange={(e) => onChange({ scheduleGroupId: e.target.value })}
                disabled={disabled || !row.facilityId || schedules.length === 0}
              >
                <option value="">All schedules</option>
                {schedules.map((sg) => (
                  <option key={sg.id} value={sg.id}>
                    {sg.name}
                    {sg.status === "published" ? "" : " — draft"}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>

          {hidden && (
            <p className="text-label font-normal text-warning flex items-start gap-1.5">
              <AlertTriangle className="size-3 shrink-0 mt-0.5" />
              Visitors won&apos;t see this until you publish {resolution.unpublished.join(" and ")}.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
