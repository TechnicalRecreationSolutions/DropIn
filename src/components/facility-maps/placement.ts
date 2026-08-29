/**
 * Shared placement model between ShapePalette (arms a preset/context item)
 * and ShapeCanvas (previews it under the cursor and commits it on click).
 * Lives outside both so neither has to import the other for just a type —
 * ShapeCanvas no longer needs anything from ShapePalette at all.
 */
import type { ShapePreset } from "@/lib/facility-shapes/presets";

export type ContextKind = "zone" | "entrance";

export interface ContextItem {
  kind: ContextKind;
  label: string;
  hint: string;
  widthM: number;
  heightM: number;
}

/** Default context-element footprints in meters. */
export const CONTEXT_ITEMS: ContextItem[] = [
  { kind: "zone", label: "Zone", hint: "Non-bookable area like a lobby or change rooms", widthM: 6, heightM: 4 },
  { kind: "entrance", label: "Entrance", hint: "Marks where visitors come in", widthM: 3, heightM: 1.2 },
];

export type ArmedPlacement = { kind: "preset"; preset: ShapePreset } | { kind: "context"; item: ContextItem };

export function armedKey(armed: ArmedPlacement): string {
  return armed.kind === "preset" ? `preset:${armed.preset.key}` : `context:${armed.item.kind}`;
}

export function armedLabel(armed: ArmedPlacement): string {
  return armed.kind === "preset" ? armed.preset.label : armed.item.label;
}

export function armedSizeMeters(armed: ArmedPlacement): { widthM: number; heightM: number } {
  return armed.kind === "preset"
    ? { widthM: armed.preset.widthM, heightM: armed.preset.heightM }
    : { widthM: armed.item.widthM, heightM: armed.item.heightM };
}

/**
 * The exact rect (canvas fractions) a placement lands at — center is the
 * cursor/tap position. Shared by ShapeCanvas's live ghost preview and
 * MapEditorClient's actual placement so the preview never lies about where
 * a shape will land.
 */
export function placementRect(
  widthM: number,
  heightM: number,
  canvasWidth: number,
  canvasHeight: number,
  center: { x: number; y: number }
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(0.9, widthM / canvasWidth);
  const height = Math.min(0.9, heightM / canvasHeight);
  return {
    width,
    height,
    x: Math.min(1 - width, Math.max(0, center.x - width / 2)),
    y: Math.min(1 - height, Math.max(0, center.y - height / 2)),
  };
}
