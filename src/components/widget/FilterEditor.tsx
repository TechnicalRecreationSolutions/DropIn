"use client";

import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronUp, Info, ListFilter, Plus, Trash2 } from "lucide-react";
import ScheduleScopeSwitcher from "@/components/schedule/ScheduleScopeSwitcher";
import { cn } from "@/lib/utils/cn";
import type { LocalScope, WidgetFacility } from "./types";

interface FilterEditorProps {
  rows: LocalScope[];
  facilities: WidgetFacility[];
  primaryColor: string;
  disabled?: boolean;
  onAdd: () => void;
  /** Seeds one row per building — the two-to-four-building case this feature exists for. */
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
 * Step 3 — the visitor-facing schedule switcher.
 *
 * The preview at the top is the *real* `ScheduleScopeSwitcher`, the same
 * component the widget renders, in the org's own brand colour. It used to be a
 * hand-drawn row of pills while the widget rendered a dropdown, so the admin
 * was designing against a picture of a UI that did not exist.
 *
 * The other half of the job is telling the truth about visibility: migration
 * 043's public read policy hides any scope whose facility, department or
 * schedule is not published, so a filter can save with a 200, sit in this list
 * forever, and never once appear on the website. Every row that would vanish
 * says so, and names the level to fix.
 *
 * Departments and schedules are fetched here, once per referenced building,
 * rather than inside each row: the preview and the summary need every row's
 * resolved names too, and a child reporting them back up to a parent that
 * renders them is a render-phase state write.
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
  const facilityIds = [...new Set(rows.map((r) => r.facilityId).filter(Boolean))];

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
  // with no department chosen, every schedule in the building).
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
    if (facility && !facility.isPublished) unpublished.push(`${facility.name} (building)`);
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

  const labelFor = (row: LocalScope, resolution: RowResolution) =>
    row.label.trim() || resolution.suggestedLabel || "Schedule";

  if (rows.length === 0) {
    return (
      <div className="text-center rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8">
        <SwitcherFrame primaryColor={primaryColor}>
          <ScheduleScopeSwitcher
            scopes={[
              { id: "a", label: "Pool", context: "Aquatic Centre › Aquatics" },
              { id: "b", label: "Fitness", context: "Aquatic Centre › Fitness" },
              { id: "c", label: "Arena", context: "Memorial Arena" },
            ]}
            activeId="a"
            onChange={() => {}}
            onTint
          />
        </SwitcherFrame>

        <h3 className="mt-4 text-base font-semibold text-foreground">One embed, every schedule</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          Add two or more filters and visitors get a switcher at the top of the widget — instead of
          you pasting a separate block of code for every building or department.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add a filter
          </button>
          {facilities.length > 1 && (
            <button
              type="button"
              onClick={onAddPerFacility}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-border text-sm font-medium rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
            >
              One per building ({facilities.length})
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filled.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <ListFilter className="w-3.5 h-3.5" />
            {filled.length > 1
              ? "Exactly what visitors will see"
              : "One filter scopes the widget but shows no switcher — add a second to give visitors a choice"}
          </p>
          <SwitcherFrame primaryColor={primaryColor}>
            {filled.length > 1 ? (
              <ScheduleScopeSwitcher
                scopes={filled.map(({ row, resolution }) => ({
                  id: row.key,
                  label: labelFor(row, resolution),
                  context: resolution.breadcrumb || undefined,
                }))}
                activeId={filled[0].row.key}
                onChange={() => {}}
                onTint
              />
            ) : (
              <p className="text-white font-semibold text-sm">
                {labelFor(filled[0].row, filled[0].resolution)}
              </p>
            )}
          </SwitcherFrame>
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-700 dark:text-amber-500" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            {hiddenCount === 1 ? "One filter points" : `${hiddenCount} filters point`} at something
            that isn&apos;t published yet, so visitors won&apos;t see{" "}
            {hiddenCount === 1 ? "it" : "them"} — even after you publish this widget. The rows below
            say which.
          </p>
        </div>
      )}

      {resolved.map(({ row, resolution }, index) => (
        <FilterRow
          key={row.key}
          row={row}
          index={index}
          total={rows.length}
          resolution={resolution}
          facilities={facilities}
          departments={departmentsFor(row.facilityId)}
          schedules={schedulesFor(row.facilityId, row.departmentId)}
          disabled={disabled}
          onChange={(patch) => onChange(row.key, patch)}
          onRemove={() => onRemove(row.key)}
          onMove={(dir) => onMove(row.key, dir)}
        />
      ))}

      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-border text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:border-blue-300 transition-colors disabled:opacity-50"
      >
        <Plus className="w-4 h-4" />
        Add another filter
      </button>
    </div>
  );
}

/** The widget's coloured bar and a hint of schedule under it, around a real switcher. */
function SwitcherFrame({
  primaryColor,
  children,
}: {
  primaryColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md rounded-lg overflow-hidden border border-border">
      <div className="px-3 py-2.5" style={{ backgroundColor: primaryColor }}>
        {children}
      </div>
      <div className="bg-card px-3 py-2.5 space-y-1.5">
        <div className="h-1.5 w-3/4 rounded-full bg-muted" />
        <div className="h-1.5 w-1/2 rounded-full bg-muted" />
      </div>
    </div>
  );
}

function FilterRow({
  row,
  index,
  total,
  resolution,
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
  resolution: RowResolution;
  facilities: WidgetFacility[];
  departments: DepartmentOption[];
  schedules: ScheduleGroupOption[];
  disabled?: boolean;
  onChange: (patch: Partial<LocalScope>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const selectClass =
    "w-full px-2.5 py-2 border border-border rounded-lg text-sm bg-card focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50";

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 space-y-3",
        resolution.unpublished.length > 0
          ? "border-amber-300 dark:border-amber-800"
          : "border-border"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 inline-flex items-center justify-center size-6 rounded-md bg-muted text-xs font-semibold text-muted-foreground">
          {index + 1}
        </span>
        <input
          type="text"
          value={row.label}
          onChange={(e) => onChange({ label: e.target.value })}
          // Follows the deepest selection, so picking "Lane Swim" offers
          // "Lane Swim" rather than the building's name.
          placeholder={resolution.suggestedLabel || "Name this filter, e.g. Pool"}
          aria-label={`Filter ${index + 1} label`}
          className="flex-1 min-w-0 px-3 py-2 border border-border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
            title="Move up"
            aria-label={`Move filter ${index + 1} up`}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={disabled || index === total - 1}
            title="Move down"
            aria-label={`Move filter ${index + 1} down`}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove this filter"
            aria-label={`Remove filter ${index + 1}`}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground mb-1">Building</span>
          <select
            value={row.facilityId}
            onChange={(e) =>
              onChange({ facilityId: e.target.value, departmentId: "", scheduleGroupId: "" })
            }
            disabled={disabled}
            className={selectClass}
          >
            <option value="">Choose a building…</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.isPublished ? "" : " — draft"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground mb-1">
            Department
          </span>
          <select
            value={row.departmentId}
            onChange={(e) => onChange({ departmentId: e.target.value, scheduleGroupId: "" })}
            disabled={disabled || !row.facilityId || departments.length === 0}
            className={selectClass}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.is_published ? "" : " — draft"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium text-muted-foreground mb-1">Schedule</span>
          <select
            value={row.scheduleGroupId}
            onChange={(e) => onChange({ scheduleGroupId: e.target.value })}
            disabled={disabled || !row.facilityId || schedules.length === 0}
            className={selectClass}
          >
            <option value="">All schedules</option>
            {schedules.map((sg) => (
              <option key={sg.id} value={sg.id}>
                {sg.name}
                {sg.status === "published" ? "" : " — draft"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!row.facilityId ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-500">
          Pick a building — filters without one are dropped when you publish.
        </p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Info className="w-3 h-3 shrink-0" />
            Shows {resolution.breadcrumb}
          </p>
          {resolution.unpublished.length > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-500 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
              Visitors won&apos;t see this filter until you publish{" "}
              {resolution.unpublished.join(" and ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
