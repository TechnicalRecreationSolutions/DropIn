"use client";

import { Waves, Square, Snowflake, Building2, MapPin, DoorOpen, type LucideIcon } from "lucide-react";
import { SHAPE_PRESETS, SHAPE_PRESET_CATEGORIES, type ShapePreset } from "@/lib/facility-shapes/presets";
import { CONTEXT_ITEMS, armedKey, type ArmedPlacement } from "./placement";

interface ShapePaletteProps {
  disabled: boolean;
  armed: ArmedPlacement | null;
  onArm: (next: ArmedPlacement | null) => void;
}

const CATEGORY_ICONS: Record<ShapePreset["category"], LucideIcon> = {
  pool: Waves,
  court: Square,
  rink: Snowflake,
  generic: Building2,
};

const CONTEXT_ICONS = {
  zone: MapPin,
  entrance: DoorOpen,
} satisfies Record<(typeof CONTEXT_ITEMS)[number]["kind"], LucideIcon>;

/**
 * Preset picker — tap a card to arm it, then tap the canvas to place it
 * there (ShapeCanvas shows a live sizing ghost while armed; Escape or
 * tapping the armed card again cancels). Replaces an earlier
 * press-and-drag-across-the-viewport gesture: two independent taps are far
 * more reliable on mobile — the canvas can be a full scroll away from this
 * palette — and this model is keyboard-reachable, which a raw pointer drag
 * never was. Real-world dimensions are always visible, not hidden behind a
 * hover `title` that never fires on touch. A small icon per category gives
 * the list something to scan by shape rather than reading every label.
 */
export default function ShapePalette({ disabled, armed, onArm }: ShapePaletteProps) {
  function toggle(next: ArmedPlacement) {
    onArm(armed && armedKey(armed) === armedKey(next) ? null : next);
  }

  return (
    <div>
      {SHAPE_PRESET_CATEGORIES.map((category) => {
        const presets = SHAPE_PRESETS.filter((p) => p.category === category.value);
        if (presets.length === 0) return null;
        const Icon = CATEGORY_ICONS[category.value];
        return (
          <div key={category.value} className="mb-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              <Icon className="w-3.5 h-3.5" />
              {category.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <PresetCard
                  key={preset.key}
                  icon={Icon}
                  active={!!armed && armedKey(armed) === armedKey({ kind: "preset", preset })}
                  disabled={disabled}
                  label={preset.label}
                  dims={`${preset.widthM}×${preset.heightM}m`}
                  onClick={() => toggle({ kind: "preset", preset })}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Context scenery is placeable even when every space is assigned —
          it never consumes a Space. */}
      <div className="mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Context</p>
        <div className="flex flex-wrap gap-2">
          {CONTEXT_ITEMS.map((item) => (
            <PresetCard
              key={item.kind}
              icon={CONTEXT_ICONS[item.kind]}
              active={!!armed && armedKey(armed) === armedKey({ kind: "context", item })}
              disabled={false}
              dashed
              label={item.label}
              dims={item.hint}
              onClick={() => toggle({ kind: "context", item })}
            />
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground/70 mt-2">
        {disabled
          ? "Setting up this floor plan…"
          : armed
            ? `Tap the map above to place a ${armed.kind === "preset" ? armed.preset.label : armed.item.label}. Tap it again or press Escape to cancel.`
            : "Tap a shape, then tap the map above to place it."}
      </p>
    </div>
  );
}

function PresetCard({
  icon: Icon,
  active,
  disabled,
  dashed,
  label,
  dims,
  onClick,
}: {
  icon: LucideIcon;
  active: boolean;
  disabled: boolean;
  dashed?: boolean;
  label: string;
  dims: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex flex-col items-start gap-1 px-3 py-2 rounded-lg border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "bg-blue-600 border-blue-600 text-white"
          : dashed
            ? "bg-muted border-dashed border-border text-muted-foreground hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
            : "bg-card border-border text-foreground hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
      }`}
    >
      <Icon className={`w-4 h-4 ${active ? "text-white" : "text-muted-foreground/70"}`} />
      <span className="text-xs font-medium">{label}</span>
      <span className={`text-[10px] ${active ? "text-blue-100" : "text-muted-foreground/70"}`}>{dims}</span>
    </button>
  );
}
