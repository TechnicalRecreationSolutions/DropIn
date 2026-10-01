"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { mapHref } from "@/lib/schedule/commandCentreHref";
import { Switch } from "@/components/ui/switch";
import LayoutThumbnail from "./LayoutThumbnail";
import type { ScheduleTemplate } from "@/types/schedule.types";

interface LayoutPickerProps {
  /** Ordered — index 0 is the view the widget boots into. */
  value: ScheduleTemplate[];
  onChange: (next: ScheduleTemplate[]) => void;
  /** Which buildings the floorplan would draw, and whether each has a map to draw. */
  floorplan: FloorplanState;
  /** Adds one Schedules entry per building. */
  onAddBuildings: () => void;
  /** Opens Install at its building picker. */
  onPickFacility: () => void;
  disabled?: boolean;
}

export type MapStatus = "checking" | "none" | "draft" | "published";

/**
 * What the Floorplan row knows. A map is drawn per building, so the embed
 * needs a building: the Install section's snippet scope, the org's only
 * building, or — the usual case — the Schedules switcher, whose every entry
 * names one and whose selected entry the floorplan follows. Each building's
 * map status is listed so the row can say exactly which ones still need
 * drawing or publishing and link to each.
 */
export type FloorplanState =
  | { kind: "pick-facility" }
  | {
      kind: "buildings";
      /** True when the floorplan follows the Schedules switcher. */
      followsSwitcher: boolean;
      buildings: { id: string; name: string; map: MapStatus }[];
    };

/** Locked while no building is known, or none of them has a published map yet. */
export function floorplanLocked(state: FloorplanState): boolean {
  return state.kind === "pick-facility" || !state.buildings.some((b) => b.map === "published");
}

/** Visitor-facing view names, in the order the picker lists them. */
export const VIEW_LABELS: Record<ScheduleTemplate, string> = {
  grid: "Week grid",
  list: "List",
  map: "By space",
  board: "Timetable",
  floorplan: "Floorplan",
};

const LAYOUTS: { value: ScheduleTemplate; blurb: string }[] = [
  { value: "grid", blurb: "The whole week, one column per day." },
  { value: "list", blurb: "Day by day. Easiest to read on a phone." },
  { value: "map", blurb: "Grouped by pool, gym, studio, court." },
  { value: "board", blurb: "Times down the side, days across." },
  { value: "floorplan", blurb: "A picture of your building. Tap a space." },
];

/**
 * The "which views can visitors use" picker.
 *
 * Two things are being chosen at once and the UI has to keep them apart: which
 * views are *available* (the set, one switch per row), and which one *loads
 * first* (the order — `allowed_templates[0]`, which is what
 * `WidgetScheduleClient` boots into). The order already round-trips through the
 * API as an array, so the default view is a free feature; it just needed to be
 * sayable, which is the "Loads first" pill and the "Load first" action on the
 * other enabled rows.
 */
export default function LayoutPicker({
  value,
  onChange,
  floorplan,
  onAddBuildings,
  onPickFacility,
  disabled,
}: LayoutPickerProps) {
  function toggle(template: ScheduleTemplate) {
    if (value.includes(template)) {
      // At least one view has to stay on — a widget with nothing to render is
      // not a state worth supporting.
      if (value.length === 1) return;
      onChange(value.filter((t) => t !== template));
      return;
    }
    onChange([...value, template]);
  }

  function makeDefault(template: ScheduleTemplate) {
    onChange([template, ...value.filter((t) => t !== template)]);
  }

  return (
    <ul className="rounded-card border border-border divide-y divide-border">
      {LAYOUTS.map(({ value: template, blurb }) => {
        const label = VIEW_LABELS[template];
        const checked = value.includes(template);
        const isDefault = checked && value[0] === template;
        const isFloorplan = template === "floorplan";
        const locked = isFloorplan && floorplanLocked(floorplan);
        const isLast = checked && value.length === 1;
        const labelId = `widget-view-${template}`;

        return (
          <li key={template} className="flex items-start gap-3 px-3 py-3">
            <div
              className={cn(
                "w-14 shrink-0 rounded-control border border-border bg-muted p-1",
                (locked || !checked) && "opacity-60"
              )}
            >
              <LayoutThumbnail template={template} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span id={labelId} className={cn("text-body font-medium", locked ? "text-muted-foreground" : "text-foreground")}>
                  {label}
                </span>
                {isDefault && (
                  <span className="inline-flex items-center rounded-full bg-brand-subtle px-2 py-0.5 text-label text-brand-strong">
                    Loads first
                  </span>
                )}
              </div>
              <p className="text-caption text-muted-foreground">
                {isFloorplan ? floorplanSummary(floorplan) ?? blurb : blurb}
              </p>
              {isFloorplan && (
                <FloorplanActions state={floorplan} onAddBuildings={onAddBuildings} onPickFacility={onPickFacility} />
              )}
              {checked && !isDefault && (
                <button
                  type="button"
                  onClick={() => makeDefault(template)}
                  disabled={disabled}
                  aria-label={`Make ${label} load first`}
                  className={actionClass}
                >
                  Load first
                </button>
              )}
            </div>

            <Switch
              checked={checked}
              onCheckedChange={() => toggle(template)}
              // A locked floorplan can still be switched *off*; only turning it
              // on waits for a map. The last view on can't be switched off.
              disabled={disabled || (locked && !checked) || isLast}
              aria-labelledby={labelId}
              title={isLast ? "At least one view stays on" : undefined}
              className="mt-0.5"
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The row's one-line state, or null for the plain blurb (one building, map
 * published — nothing to explain).
 */
function floorplanSummary(state: FloorplanState): string | null {
  if (state.kind === "pick-facility") {
    return "Needs one building with a published floor map. Add your buildings under Schedules, or pick one under Install.";
  }
  const { buildings, followsSwitcher } = state;
  if (buildings.some((b) => b.map === "checking")) return "Checking maps…";
  if (buildings.length === 1 && !followsSwitcher) {
    const [b] = buildings;
    if (b.map === "none") return `Needs a published floor map. ${b.name} has none yet.`;
    if (b.map === "draft") return `Needs a published floor map. ${b.name}'s is still a draft.`;
    return null;
  }
  const ready = buildings.filter((b) => b.map === "published").length;
  if (ready === buildings.length) {
    return `Follows the switcher. ${buildings.length === 1 ? "Its building's" : `All ${buildings.length}`} map${buildings.length === 1 ? " is" : "s are"} ready.`;
  }
  return `Follows the switcher. ${ready} of ${buildings.length} building maps are ready.`;
}

const actionClass =
  "touch-target mt-1 inline-flex rounded-sm text-left text-caption font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** The fixes, as links on the row. */
function FloorplanActions({
  state,
  onAddBuildings,
  onPickFacility,
}: {
  state: FloorplanState;
  onAddBuildings: () => void;
  onPickFacility: () => void;
}) {
  if (state.kind === "pick-facility") {
    return (
      <div className="flex flex-wrap gap-x-4">
        <button type="button" onClick={onAddBuildings} className={actionClass}>
          Add each building
        </button>
        <button type="button" onClick={onPickFacility} className={actionClass}>
          Pick one under Install
        </button>
      </div>
    );
  }

  const missing = state.buildings.filter((b) => b.map === "none" || b.map === "draft");
  if (missing.length === 0) return null;
  const single = state.buildings.length === 1 && !state.followsSwitcher;

  return (
    <ul className="space-y-0.5">
      {missing.map((b) => (
        <li key={b.id} className="text-caption text-muted-foreground">
          {!single && (
            <span>
              {b.name}: {b.map === "none" ? "no map" : "draft"} ·{" "}
            </span>
          )}
          <Link href={mapHref(b.id)} className={actionClass}>
            {b.map === "none" ? "Draw it on the Map page" : "Publish it on the Map page"}
          </Link>
        </li>
      ))}
    </ul>
  );
}
