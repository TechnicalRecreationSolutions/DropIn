"use client";

import { Trash2 } from "lucide-react";
import type { EditableShape, EditableContextElement } from "./ShapeCanvas";

interface ShapeAssignmentListProps {
  shapes: EditableShape[];
  contextElements: EditableContextElement[];
  spaces: { id: string; name: string }[];
  onChange: (shapes: EditableShape[], contextElements: EditableContextElement[]) => void;
  onCommit: () => void;
}

/**
 * Per-placed-shape settings: which Space a hotspot maps to and its label
 * override, plus zone/entrance labels — split out from ShapeCanvas so
 * MapEditorClient can position it independently. It used to render directly
 * under the canvas, which pushed ShapePalette (the thing you reach for on
 * every placement) further down the page with every shape placed; this list
 * is secondary, review-and-rename config, not the primary place-a-shape
 * loop, so it now sits below the canvas+palette row instead of between them.
 */
export default function ShapeAssignmentList({
  shapes,
  contextElements,
  spaces,
  onChange,
  onCommit,
}: ShapeAssignmentListProps) {
  if (shapes.length === 0 && contextElements.length === 0) return null;

  const assignedSpaceIds = new Set(shapes.map((s) => s.space_id));

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Placed shapes</p>
      <div className="space-y-2">
        {shapes.map((shape) => (
          <div key={shape.key} className="flex items-center gap-2 p-3 bg-white rounded-lg border border-gray-200 flex-wrap">
            <select
              value={shape.space_id}
              onChange={(e) => {
                onChange(
                  shapes.map((s) => (s.key === shape.key ? { ...s, space_id: e.target.value } : s)),
                  contextElements
                );
                onCommit();
              }}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id} disabled={s.id !== shape.space_id && assignedSpaceIds.has(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={shape.label ?? ""}
              onChange={(e) =>
                onChange(
                  shapes.map((s) => (s.key === shape.key ? { ...s, label: e.target.value || null } : s)),
                  contextElements
                )
              }
              onBlur={onCommit}
              placeholder="Label override (optional)"
              className="flex-1 min-w-[140px] px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => {
                onChange(shapes.filter((s) => s.key !== shape.key), contextElements);
                onCommit();
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              aria-label="Remove shape"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        {contextElements.map((ctx) => (
          <div key={ctx.key} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 w-20 shrink-0">
              {ctx.kind === "entrance" ? "Entrance" : "Zone"}
            </span>
            <input
              type="text"
              value={ctx.label ?? ""}
              onChange={(e) =>
                onChange(
                  shapes,
                  contextElements.map((c) => (c.key === ctx.key ? { ...c, label: e.target.value || null } : c))
                )
              }
              onBlur={onCommit}
              placeholder={ctx.kind === "entrance" ? "Entrance" : "e.g. Lobby, Change Rooms"}
              className="flex-1 min-w-[140px] px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => {
                onChange(shapes, contextElements.filter((c) => c.key !== ctx.key));
                onCommit();
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              aria-label="Remove context element"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
