"use client";

import { useRef } from "react";
import { Trash2, RotateCw } from "lucide-react";
import {
  resizeFromOppositeCorner,
  angleFromCenter,
  clampRotation,
  center,
  laneRectsWithinGroup,
} from "@/lib/facility-shapes/geometry";

export interface EditableShape {
  /** Stable client-side key — real shapes use their DB id, new ones a generated one. */
  key: string;
  space_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string | null;
  /** Preset the shape was placed from — drives its illustrated rendering (see renderer/). */
  presetKey: string;
  /** Shared by every lane belonging to one placed multi-lane preset; null for a standalone shape. */
  groupId: string | null;
  /** Stable relative order within a group — never read as a literal slot number, see geometry.ts. */
  laneIndex: number | null;
}

interface ShapeCanvasProps {
  canvasWidth: number;
  canvasHeight: number;
  shapes: EditableShape[];
  spaces: { id: string; name: string }[];
  onChange: (shapes: EditableShape[]) => void;
}

interface Point {
  x: number;
  y: number;
}

const MIN_SIZE = 0.03;

/** Every row that shares a shape's outer rect — itself alone if standalone, or its whole group. */
function siblingKeys(shape: EditableShape, allShapes: EditableShape[]): Set<string> {
  if (shape.groupId === null) return new Set([shape.key]);
  return new Set(allShapes.filter((s) => s.groupId === shape.groupId).map((s) => s.key));
}

/**
 * Blank-canvas facility diagram builder — shapes are placed via
 * MapEditorClient's handlePlacePreset (called from ShapePalette's
 * pointer-drag), then freely moved/resized/rotated/relabeled as plain
 * absolutely-positioned divs with CSS `transform: rotate()`. No canvas/SVG
 * library: move and click hit-testing ride on native DOM/CSS behavior
 * (which already accounts for the rotation transform correctly), and
 * resize is the only place that needs rotation-aware math, done via
 * lib/facility-shapes/geometry.ts.
 *
 * A multi-lane preset (e.g. "4-Lane 25m Pool") places `laneCount` rows
 * sharing one `groupId`, all carrying the IDENTICAL outer rect — there is
 * no separate "group" concept to render, just N rows agreeing on the same
 * x/y/width/height/rotation. Move/resize/rotate on any lane updates every
 * row in its group together, so the group always stays in sync; only the
 * rendering step (grouping shapes by groupId, one wrapper + N stripe divs
 * per group) is what makes them visually act as "one locked-together unit."
 */
export default function ShapeCanvas({ canvasWidth, canvasHeight, shapes, spaces, onChange }: ShapeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const assignedSpaceIds = new Set(shapes.map((s) => s.space_id));

  function pointFromEvent(e: { clientX: number; clientY: number }): Point {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function startMove(e: React.PointerEvent, shape: EditableShape) {
    e.stopPropagation();
    const p = pointFromEvent(e);
    const grabOffsetX = p.x - shape.x;
    const grabOffsetY = p.y - shape.y;
    const keys = siblingKeys(shape, shapes);

    function handleMove(moveEvent: PointerEvent) {
      const mp = pointFromEvent(moveEvent);
      const newX = Math.min(1 - shape.width, Math.max(0, mp.x - grabOffsetX));
      const newY = Math.min(1 - shape.height, Math.max(0, mp.y - grabOffsetY));
      onChange(shapes.map((s) => (keys.has(s.key) ? { ...s, x: newX, y: newY } : s)));
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function startResize(e: React.PointerEvent, shape: EditableShape) {
    e.stopPropagation();
    const keys = siblingKeys(shape, shapes);

    function handleMove(moveEvent: PointerEvent) {
      const mp = pointFromEvent(moveEvent);
      const nextRect = resizeFromOppositeCorner(shape, shape.rotation, mp, MIN_SIZE);
      onChange(shapes.map((s) => (keys.has(s.key) ? { ...s, ...nextRect } : s)));
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function startRotate(e: React.PointerEvent, shape: EditableShape) {
    e.stopPropagation();
    const containerRect = containerRef.current!.getBoundingClientRect();
    const keys = siblingKeys(shape, shapes);

    function shapeCenterScreen() {
      const c = center(shape);
      return {
        x: containerRect.left + c.x * containerRect.width,
        y: containerRect.top + c.y * containerRect.height,
      };
    }

    function handleMove(moveEvent: PointerEvent) {
      const c = shapeCenterScreen();
      const angle = clampRotation(angleFromCenter(c, { x: moveEvent.clientX, y: moveEvent.clientY }));
      onChange(shapes.map((s) => (keys.has(s.key) ? { ...s, rotation: angle } : s)));
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function updateSpaceId(key: string, spaceId: string) {
    onChange(shapes.map((s) => (s.key === key ? { ...s, space_id: spaceId } : s)));
  }

  function updateLabel(key: string, label: string) {
    onChange(shapes.map((s) => (s.key === key ? { ...s, label: label || null } : s)));
  }

  function removeShape(key: string) {
    onChange(shapes.filter((s) => s.key !== key));
  }

  // Group shapes for rendering: standalone shapes render as one rect each;
  // grouped shapes render as one wrapper (any member's shared rect) with
  // laneRectsWithinGroup stripes inside, ordered by lane_index but using
  // array position (not the raw index value) as the stripe slot — see
  // geometry.ts for why this makes deletion/reordering renumber-free.
  const standaloneShapes = shapes.filter((s) => s.groupId === null);
  const groupIds = [...new Set(shapes.filter((s) => s.groupId !== null).map((s) => s.groupId!))];
  const groups = groupIds.map((groupId) => {
    const members = shapes
      .filter((s) => s.groupId === groupId)
      .sort((a, b) => (a.laneIndex ?? 0) - (b.laneIndex ?? 0));
    return { groupId, members };
  });

  return (
    <div>
      <div
        ref={containerRef}
        data-shape-canvas="true"
        className="relative w-full rounded-xl overflow-hidden border border-gray-200 bg-gray-50 select-none touch-none"
        style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
      >
        {standaloneShapes.map((shape) => {
          const space = spaces.find((s) => s.id === shape.space_id);
          const displayLabel = shape.label ?? space?.name ?? "Unassigned";
          return (
            <div
              key={shape.key}
              onPointerDown={(e) => startMove(e, shape)}
              className="absolute border-2 border-blue-500 bg-blue-500/15 cursor-move"
              style={{
                left: `${shape.x * 100}%`,
                top: `${shape.y * 100}%`,
                width: `${shape.width * 100}%`,
                height: `${shape.height * 100}%`,
                transform: `rotate(${shape.rotation}deg)`,
                transformOrigin: "center",
              }}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-blue-700 text-center px-1 pointer-events-none">
                {displayLabel}
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeShape(shape.key);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center rounded-full bg-white border border-gray-300 text-gray-500 hover:text-red-600 hover:border-red-300 shadow-sm"
                aria-label="Remove shape"
              >
                <Trash2 className="w-3 h-3" />
              </button>

              <div
                onPointerDown={(e) => startRotate(e, shape)}
                className="absolute -top-6 left-1/2 -translate-x-1/2 w-4 h-4 flex items-center justify-center rounded-full bg-white border border-gray-300 text-gray-500 cursor-grab shadow-sm"
                aria-label="Rotate shape"
              >
                <RotateCw className="w-2.5 h-2.5" />
              </div>

              <div
                onPointerDown={(e) => startResize(e, shape)}
                className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-600 border-2 border-white cursor-nwse-resize"
              />
            </div>
          );
        })}

        {groups.map(({ groupId, members }) => {
          if (members.length === 0) return null;
          const outer = members[0]; // every member shares the identical outer rect
          const laneRects = laneRectsWithinGroup(outer, members.length);
          return (
            <div
              key={groupId}
              onPointerDown={(e) => startMove(e, outer)}
              className="absolute border-2 border-blue-500 cursor-move"
              style={{
                left: `${outer.x * 100}%`,
                top: `${outer.y * 100}%`,
                width: `${outer.width * 100}%`,
                height: `${outer.height * 100}%`,
                transform: `rotate(${outer.rotation}deg)`,
                transformOrigin: "center",
              }}
            >
              {members.map((lane, i) => {
                const laneRect = laneRects[i];
                const space = spaces.find((s) => s.id === lane.space_id);
                const displayLabel = lane.label ?? space?.name ?? "Unassigned";
                return (
                  <div
                    key={lane.key}
                    className="absolute bg-blue-500/15 border-t border-blue-300 first:border-t-0 flex items-center justify-center"
                    style={{
                      left: `${((laneRect.x - outer.x) / outer.width) * 100}%`,
                      top: `${((laneRect.y - outer.y) / outer.height) * 100}%`,
                      width: `${(laneRect.width / outer.width) * 100}%`,
                      height: `${(laneRect.height / outer.height) * 100}%`,
                    }}
                  >
                    <span className="text-[10px] font-medium text-blue-700 text-center px-1 truncate pointer-events-none">
                      {displayLabel}
                    </span>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(shapes.filter((s) => s.groupId !== groupId));
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center rounded-full bg-white border border-gray-300 text-gray-500 hover:text-red-600 hover:border-red-300 shadow-sm"
                aria-label="Remove pool"
              >
                <Trash2 className="w-3 h-3" />
              </button>

              <div
                onPointerDown={(e) => startRotate(e, outer)}
                className="absolute -top-6 left-1/2 -translate-x-1/2 w-4 h-4 flex items-center justify-center rounded-full bg-white border border-gray-300 text-gray-500 cursor-grab shadow-sm"
                aria-label="Rotate pool"
              >
                <RotateCw className="w-2.5 h-2.5" />
              </div>

              <div
                onPointerDown={(e) => startResize(e, outer)}
                className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-600 border-2 border-white cursor-nwse-resize"
              />
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 mt-2">Drag a preset from below onto the canvas to place it.</p>

      {shapes.length > 0 && (
        <div className="mt-4 space-y-2">
          {[...standaloneShapes, ...groups.flatMap((g) => g.members)].map((shape) => (
            <div key={shape.key} className="flex items-center gap-2 p-3 bg-white rounded-lg border border-gray-200 flex-wrap">
              <select
                value={shape.space_id}
                onChange={(e) => updateSpaceId(shape.key, e.target.value)}
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
                onChange={(e) => updateLabel(shape.key, e.target.value)}
                placeholder="Label override (optional)"
                className="flex-1 min-w-[140px] px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => removeShape(shape.key)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                aria-label="Remove shape"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Converts a client-space point to a 0..1 fraction of the given canvas element's rect. */
export function pointToCanvasFraction(canvasEl: HTMLElement, clientX: number, clientY: number): Point {
  const rect = canvasEl.getBoundingClientRect();
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}
