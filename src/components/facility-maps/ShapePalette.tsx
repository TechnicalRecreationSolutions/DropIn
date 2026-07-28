"use client";

import { useState } from "react";
import { SHAPE_PRESETS, SHAPE_PRESET_CATEGORIES, type ShapePreset } from "@/lib/facility-shapes/presets";
import { pointToCanvasFraction } from "./ShapeCanvas";

export type ContextKind = "zone" | "entrance";

const CONTEXT_ITEMS: { kind: ContextKind; label: string; hint: string }[] = [
  { kind: "zone", label: "Zone", hint: "Non-bookable area like a lobby or change rooms" },
  { kind: "entrance", label: "Entrance", hint: "Marks where visitors come in" },
];

interface ShapePaletteProps {
  disabled: boolean;
  onPlace: (preset: ShapePreset, dropFraction: { x: number; y: number }) => void;
  onPlaceContext: (kind: ContextKind, dropFraction: { x: number; y: number }) => void;
}

/**
 * Preset shape palette — pointer-based drag (not native HTML5 DnD) to match
 * the rest of the app's pointer-event convention and get mobile parity for
 * free. Dragging a card tracks the pointer with a small floating preview;
 * releasing over the canvas (identified via the `data-shape-canvas`
 * attribute set on ShapeCanvas's root element) places a new shape there.
 * Converting the preset's real-world size into a canvas-fraction width/
 * height happens in the caller (MapEditorClient), which is the one that
 * knows the canvas's dimensions.
 */
export default function ShapePalette({ disabled, onPlace, onPlaceContext }: ShapePaletteProps) {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  /** Shared pointer-drag: track a floating chip, then fire `place` if dropped on the canvas. */
  function startDrag(
    e: React.PointerEvent,
    label: string,
    place: (dropFraction: { x: number; y: number }) => void,
    ignoreDisabled = false
  ) {
    if (disabled && !ignoreDisabled) return;
    e.preventDefault();
    setDragLabel(label);
    setDragPos({ x: e.clientX, y: e.clientY });

    function handleMove(moveEvent: PointerEvent) {
      setDragPos({ x: moveEvent.clientX, y: moveEvent.clientY });
    }

    function handleUp(upEvent: PointerEvent) {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);

      const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const canvasEl = target?.closest<HTMLElement>('[data-shape-canvas="true"]');
      if (canvasEl) {
        place(pointToCanvasFraction(canvasEl, upEvent.clientX, upEvent.clientY));
      }

      setDragLabel(null);
      setDragPos(null);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <div>
      {SHAPE_PRESET_CATEGORIES.map((category) => {
        const presets = SHAPE_PRESETS.filter((p) => p.category === category.value);
        if (presets.length === 0) return null;
        return (
          <div key={category.value} className="mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{category.label}</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onPointerDown={(e) => startDrag(e, preset.label, (f) => onPlace(preset, f))}
                  disabled={disabled}
                  className="px-3 py-2 text-xs font-medium bg-white border border-gray-300 rounded-lg text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-none"
                  title={`${preset.widthM}m × ${preset.heightM}m`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Context scenery is placeable even when every space is assigned —
          it never consumes a Space. */}
      <div className="mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Context</p>
        <div className="flex flex-wrap gap-2">
          {CONTEXT_ITEMS.map((item) => (
            <button
              key={item.kind}
              type="button"
              onPointerDown={(e) => startDrag(e, item.label, (f) => onPlaceContext(item.kind, f), true)}
              className="px-3 py-2 text-xs font-medium bg-gray-50 border border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors touch-none"
              title={item.hint}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {dragLabel && dragPos && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg shadow-lg opacity-90"
          style={{ left: dragPos.x + 12, top: dragPos.y + 12 }}
        >
          {dragLabel}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-2">
        {disabled
          ? "Every space is placed — you can still add zones and an entrance."
          : "Press and drag an item onto the canvas above."}
      </p>
    </div>
  );
}
