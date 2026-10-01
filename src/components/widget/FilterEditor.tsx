"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { AlertTriangle, ChevronDown, GripVertical, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { LocalScope, WidgetFacility } from "./types";

interface FilterEditorProps {
  rows: LocalScope[];
  facilities: WidgetFacility[];
  /** False when the org has no schedules at all — the list has nothing to point at yet. */
  hasSchedules: boolean;
  disabled?: boolean;
  onAdd: () => void;
  /** Seeds one row per facility — the two-to-four-facility case this feature exists for. */
  onAddPerFacility: () => void;
  onChange: (key: string, patch: Partial<LocalScope>) => void;
  onRemove: (key: string) => void;
  /** One step up or down — the keyboard path, from the grip's arrow keys. */
  onMove: (key: string, direction: -1 | 1) => void;
  /** Drop a row where another one is — the pointer path, from dragging the grip. */
  onMoveTo: (key: string, toKey: string) => void;
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
 * The Schedules section, whole: the list of schedules the embed publishes.
 *
 * There used to be two controls here — a row of facility/department tiles that
 * addressed a `widget_configs` row, and this list — and they answered the same
 * question with different answers, since `WidgetScheduleClient` renders the
 * selected *entry's* facility and department and ignores the config's the
 * moment the list has anything in it. Migration 045 collapsed settings to one
 * row per org, which leaves this list as the only thing saying what an embed
 * shows: empty is everything the org runs, one entry is that schedule, two or
 * more give visitors a switcher. Narrowing a single copy of the code to one
 * facility is a snippet option under Install, not a second saved configuration.
 *
 * The list is the editor. Each row collapses to one line — its label, where it
 * points, and whether visitors can actually see it — and opens to the three
 * pickers only while you are changing it, so an org with four facilities reads
 * four lines instead of four tall forms. Rows that are still local (`new-`
 * keys, i.e. added since the last publish) and rows with no facility yet open
 * themselves, because those are the ones with something left to fill in.
 *
 * Order is the switcher's order. The grip drags (dnd-kit, the same core-only
 * pattern as `SpaceSections`) and is also a focusable button whose arrow keys
 * step the row, so one handle serves pointer, touch and keyboard.
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
  hasSchedules,
  disabled,
  onAdd,
  onAddPerFacility,
  onChange,
  onRemove,
  onMove,
  onMoveTo,
}: FilterEditorProps) {
  /** Explicit open/closed, per row — overrides the default below when set. */
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  // A short distance/delay before a drag starts, so a tap on the grip is
  // still a tap and a touch drag elsewhere still scrolls the page.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } })
  );

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

  function handleDragEnd(event: DragEndEvent) {
    setDraggingKey(null);
    const overKey = event.over?.id;
    if (typeof overKey !== "string" || overKey === event.active.id) return;
    onMoveTo(String(event.active.id), overKey);
  }

  if (!hasSchedules && rows.length === 0) {
    const createHref =
      facilities.length > 0
        ? `/dashboard/facilities/${facilities[0].id}/schedule-groups/new`
        : "/dashboard/facilities/new";
    return (
      <p className="text-body text-foreground">
        You have no schedules yet, so the widget has nothing to show.{" "}
        <Link href={createHref} className="font-medium text-brand underline-offset-4 hover:underline">
          {facilities.length > 0 ? "Create a schedule" : "Add a facility first"}
        </Link>
      </p>
    );
  }

  const perBuilding = facilities.length > 1 && (
    <Button type="button" variant="link" onClick={onAddPerFacility} disabled={disabled} className="touch-target">
      Add one per building
    </Button>
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-banner border border-dashed border-border px-5 py-8 text-center">
        <p className="text-body font-medium text-foreground">Showing everything you run</p>
        <p className="mt-1 text-caption text-muted-foreground">
          Add one to narrow it down, or several to give visitors a switcher.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Button type="button" variant="outline" onClick={onAdd} disabled={disabled}>
            <Plus />
            Add a schedule
          </Button>
          {perBuilding}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setDraggingKey(String(e.active.id))}
        onDragCancel={() => setDraggingKey(null)}
        onDragEnd={handleDragEnd}
      >
        <ul className="space-y-2">
          {resolved.map(({ row, resolution }, index) => (
            <FilterRow
              key={row.key}
              row={row}
              index={index}
              total={rows.length}
              resolution={resolution}
              label={labelFor(row, resolution)}
              open={isOpen(row)}
              dragging={draggingKey === row.key}
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
      </DndContext>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" variant="outline" onClick={onAdd} disabled={disabled}>
          <Plus />
          Add a schedule
        </Button>
        {perBuilding}
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
          } at is published.`}{" "}
        Remove them all to show everything you run.
      </p>
    </div>
  );
}

function FilterRow({
  row,
  index,
  total,
  resolution,
  label,
  open,
  dragging,
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
  resolution: RowResolution;
  label: string;
  open: boolean;
  dragging: boolean;
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

  // `attributes` is not spread onto the grip, for the reason SpaceSections
  // gives: its aria-describedby id comes from a counter that restarts on the
  // client and breaks hydration. The grip carries its own label and keys.
  const { setNodeRef: setDragRef, setActivatorNodeRef, listeners } = useDraggable({
    id: row.key,
    disabled,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: row.key });
  const ref = (node: HTMLElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  return (
    <li
      ref={ref}
      className={cn(
        "rounded-banner border bg-card transition-colors duration-150",
        isOver && !dragging ? "border-brand bg-brand-subtle" : "border-border",
        dragging && "opacity-40"
      )}
    >
      <div className="flex items-center gap-1 py-1.5 pl-1 pr-1.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...listeners}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && index > 0) {
              e.preventDefault();
              onMove(-1);
            } else if (e.key === "ArrowDown" && index < total - 1) {
              e.preventDefault();
              onMove(1);
            }
          }}
          disabled={disabled || total < 2}
          aria-label={`Reorder ${incomplete ? `entry ${index + 1}` : label}: drag, or use the up and down arrow keys`}
          title="Drag to reorder"
          className="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
        >
          <GripVertical className="size-4" />
        </button>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={incomplete ? `Edit unfinished entry ${index + 1}` : `Edit ${label}`}
          // focus-visible, not focus: a mouse click on a row would otherwise
          // leave a ring around it that reads as a text field.
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "truncate text-body font-semibold",
                  incomplete ? "font-medium italic text-muted-foreground" : "text-foreground"
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
            <span className="block truncate text-caption text-muted-foreground">
              {incomplete ? "Pick a facility. Until then this is dropped when you publish." : resolution.breadcrumb}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")}
          />
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          title="Remove"
          aria-label={`Remove ${incomplete ? `entry ${index + 1}` : label}`}
          className="touch-target text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>

      {open && (
        // Indented to the row's own title, so an open row reads as that row's
        // detail rather than as a panel the whole list dropped down.
        <div className="space-y-2.5 border-t border-border px-3 pb-3 pt-3 sm:pl-10">
          <label className="block">
            <span className="mb-1 block text-label text-muted-foreground">
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

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-label text-muted-foreground">Facility</span>
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
                    {f.isPublished ? "" : " (draft)"}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="block">
              <span className="mb-1 block text-label text-muted-foreground">Department</span>
              <NativeSelect
                value={row.departmentId}
                onChange={(e) => onChange({ departmentId: e.target.value, scheduleGroupId: "" })}
                disabled={disabled || !row.facilityId || departments.length === 0}
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.is_published ? "" : " (draft)"}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="block">
              <span className="mb-1 block text-label text-muted-foreground">Schedule</span>
              <NativeSelect
                value={row.scheduleGroupId}
                onChange={(e) => onChange({ scheduleGroupId: e.target.value })}
                disabled={disabled || !row.facilityId || schedules.length === 0}
              >
                <option value="">All schedules</option>
                {schedules.map((sg) => (
                  <option key={sg.id} value={sg.id}>
                    {sg.name}
                    {sg.status === "published" ? "" : " (draft)"}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>

          {hidden && (
            <p className="flex items-start gap-1.5 text-caption text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Visitors won&apos;t see this until you publish {resolution.unpublished.join(" and ")}.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
