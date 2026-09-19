"use client";

import Link from "next/link";
import { Check, Lock, Star } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { mapHref } from "@/lib/schedule/commandCentreHref";
import LayoutThumbnail from "./LayoutThumbnail";
import type { ScheduleTemplate } from "@/types/schedule.types";

interface LayoutPickerProps {
  /** Ordered — index 0 is the view the widget boots into. */
  value: ScheduleTemplate[];
  onChange: (next: ScheduleTemplate[]) => void;
  /** Which buildings the floorplan would draw, and whether each has a map to draw. */
  floorplan: FloorplanState;
  /** Adds one step 1 switcher entry per building. */
  onAddBuildings: () => void;
  /** Takes the admin to step 4's building picker. */
  onPickFacility: () => void;
  disabled?: boolean;
}

export type MapStatus = "checking" | "none" | "draft" | "published";

/**
 * What the Floorplan card knows. A map is drawn per building, so the embed
 * needs a building: the step 4 snippet scope, the org's only building, or —
 * the usual case — the step 1 switcher, whose every entry names one and whose
 * selected entry the floorplan follows. Each building's map status is listed
 * so the card can say exactly which ones still need drawing or publishing and
 * link to each.
 */
export type FloorplanState =
  | { kind: "pick-facility" }
  | {
      kind: "buildings";
      /** True when the floorplan follows the step 1 switcher. */
      followsSwitcher: boolean;
      buildings: { id: string; name: string; map: MapStatus }[];
    };

/** Locked while no building is known, or none of them has a published map yet. */
export function floorplanLocked(state: FloorplanState): boolean {
  return state.kind === "pick-facility" || !state.buildings.some((b) => b.map === "published");
}

const LAYOUTS: { value: ScheduleTemplate; label: string; blurb: string }[] = [
  { value: "grid", label: "Week grid", blurb: "The whole week, one column per day." },
  { value: "list", label: "List", blurb: "Day by day — easiest to read on a phone." },
  { value: "map", label: "By space", blurb: "Grouped by pool, gym, studio, court." },
  { value: "board", label: "Timetable", blurb: "Times down the side, days across." },
  { value: "floorplan", label: "Floorplan", blurb: "A picture of your facility, tap a space." },
];

/**
 * The "which views can visitors use" picker.
 *
 * Two things are being chosen at once and the UI has to keep them apart: which
 * views are *available* (the set), and which one *loads first* (the order —
 * `allowed_templates[0]`, which is what `WidgetScheduleClient` boots into). The
 * order already round-trips through the API as an array, so the default view is
 * a free feature; it just needed to be sayable.
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {LAYOUTS.map(({ value: template, label, blurb }) => {
        const checked = value.includes(template);
        const isDefault = checked && value[0] === template;
        const isFloorplan = template === "floorplan";
        const locked = isFloorplan && floorplanLocked(floorplan);
        const isDisabled = disabled || locked;

        return (
          <div
            key={template}
            className={cn(
              "relative flex flex-col rounded-xl border bg-card transition-all",
              checked ? "border-blue-600 ring-2 ring-blue-600/25" : "border-border",
              isDisabled && "opacity-55"
            )}
          >
            {/* Full-card hit target sits *under* the artwork, so the whole tile
                toggles while the "Loads first" control above it stays clickable. */}
            <button
              type="button"
              onClick={() => toggle(template)}
              disabled={isDisabled}
              aria-pressed={checked}
              className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
            >
              <span className="sr-only">
                {label}
                {locked ? ` — ${floorplanSummary(floorplan)}` : ""}
              </span>
            </button>

            <div className="relative z-[1] flex-1 pointer-events-none p-2.5">
              <div
                className={cn(
                  "rounded-lg overflow-hidden border border-border/60 bg-muted/40 p-1.5",
                  checked ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"
                )}
              >
                <LayoutThumbnail template={template} />
              </div>
              <p className="mt-2 text-sm font-medium text-foreground flex items-center gap-1.5">
                {label}
                {locked && <Lock className="w-3 h-3 text-muted-foreground" />}
              </p>
              <p className="text-[11px] leading-snug text-muted-foreground mt-0.5">
                {isFloorplan ? floorplanSummary(floorplan) ?? blurb : blurb}
              </p>
              {isFloorplan && (
                <FloorplanActions
                  state={floorplan}
                  onAddBuildings={onAddBuildings}
                  onPickFacility={onPickFacility}
                />
              )}
            </div>

            {/* In flow, not floated over the blurb — overlapping the copy made
                "Load first" read as the end of the description. */}
            {checked && !isDefault && (
              <div className="relative z-[2] px-2.5 pb-2.5">
                <button
                  type="button"
                  onClick={() => makeDefault(template)}
                  aria-label={`Make ${label} load first`}
                  className="w-full py-1 rounded-md bg-muted text-[11px] font-medium text-muted-foreground hover:bg-blue-600 hover:text-white transition-colors"
                >
                  Load first
                </button>
              </div>
            )}

            {checked && (
              <span className="absolute top-2 right-2 z-[2] inline-flex items-center justify-center size-5 rounded-full bg-blue-600 text-white pointer-events-none">
                <Check className="w-3 h-3" />
              </span>
            )}

            {isDefault && (
              <span className="absolute -top-2 left-2.5 z-[2] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-semibold pointer-events-none">
                <Star className="w-2.5 h-2.5 fill-current" />
                Loads first
              </span>
            )}

          </div>
        );
      })}
    </div>
  );
}

/**
 * The card's one-line state, or null for the plain blurb (one building, map
 * published — nothing to explain).
 */
function floorplanSummary(state: FloorplanState): string | null {
  if (state.kind === "pick-facility") {
    return "Draws one building — add your buildings to the switcher in step 1, or pick one in step 4.";
  }
  const { buildings, followsSwitcher } = state;
  if (buildings.some((b) => b.map === "checking")) return "Checking maps…";
  if (buildings.length === 1 && !followsSwitcher) {
    const [b] = buildings;
    if (b.map === "none") return `${b.name} has no map yet.`;
    if (b.map === "draft") return `${b.name}'s map is still a draft.`;
    return null;
  }
  const ready = buildings.filter((b) => b.map === "published").length;
  if (ready === buildings.length) {
    return `Follows the switcher — ${buildings.length === 1 ? "its building's" : `all ${buildings.length}`} map${buildings.length === 1 ? "" : "s"} ready.`;
  }
  return `Follows the switcher — ${ready} of ${buildings.length} building maps ready.`;
}

const actionClass =
  "pointer-events-auto inline-flex text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline";

/**
 * The fixes, as controls on the card. The card's text layer is
 * pointer-events-none (the whole tile is one toggle button underneath, which
 * is disabled while locked), so each control takes its events back.
 */
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
      <div className="mt-1.5 flex flex-col items-start gap-1">
        <button type="button" onClick={onAddBuildings} className={actionClass}>
          Add each building to the switcher →
        </button>
        <button type="button" onClick={onPickFacility} className={actionClass}>
          Or pick one in step 4 →
        </button>
      </div>
    );
  }

  const missing = state.buildings.filter((b) => b.map === "none" || b.map === "draft");
  if (missing.length === 0) return null;
  const single = state.buildings.length === 1 && !state.followsSwitcher;

  return (
    <ul className="mt-1.5 space-y-1">
      {missing.map((b) => (
        <li key={b.id} className="text-[11px] leading-snug text-muted-foreground">
          {!single && (
            <span>
              {b.name}: {b.map === "none" ? "no map" : "draft"} ·{" "}
            </span>
          )}
          <Link href={mapHref(b.id)} className={actionClass}>
            {b.map === "none" ? "Draw its map →" : "Publish its map →"}
          </Link>
        </li>
      ))}
    </ul>
  );
}
