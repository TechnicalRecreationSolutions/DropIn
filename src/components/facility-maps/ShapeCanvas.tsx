"use client";

import { useMemo, useRef, useState } from "react";
import { Trash2, RotateCw, Copy } from "lucide-react";
import FacilityMapSvg from "./renderer/FacilityMapSvg";
import type { RenderShape, RenderContextElement } from "./renderer/types";
import {
  resizeFromOppositeCorner,
  angleFromCenter,
  clampRotation,
  center,
  snapValue,
  snapAngle,
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

export interface EditableContextElement {
  key: string;
  kind: "zone" | "entrance";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string | null;
}

interface ShapeCanvasProps {
  /** Canvas extent in meters (facility_maps.canvas_width/height). */
  canvasWidth: number;
  canvasHeight: number;
  shapes: EditableShape[];
  contextElements: EditableContextElement[];
  spaces: { id: string; name: string }[];
  /** Live geometry/field updates (fires continuously during a drag). */
  onChange: (shapes: EditableShape[], contextElements: EditableContextElement[]) => void;
  /** A gesture or atomic edit finished — the caller records an undo step. */
  onCommit: () => void;
  /** Duplicate needs a Space for the copy, which only the caller can arrange. */
  onDuplicate: (shape: EditableShape) => void;
}

interface Point {
  x: number;
  y: number;
}

const MIN_SIZE = 0.03;
/** Grid pitch in meters — every move/resize lands on a tidy half-meter. */
const GRID_METERS = 0.5;
/** Snap radius in screen pixels (converted to canvas fractions per axis). */
const SNAP_PX = 8;
const ROTATION_SNAP_STEP = 15;
const ROTATION_SNAP_THRESHOLD = 6;
/** Arrow-key nudge in meters; Shift steps a full grid cell. */
const NUDGE_METERS = 0.1;

/**
 * One draggable unit on the canvas: a standalone shape, a whole lane group
 * (which moves/resizes/rotates as one), or a context element. `rect` is any
 * member's shared geometry; `memberKeys` is every row the unit updates.
 */
interface EditUnit {
  unitKey: string;
  kind: "shape" | "group" | "context";
  rect: { x: number; y: number; width: number; height: number; rotation: number };
  memberKeys: Set<string>;
  label: string;
  /** The representative shape for duplicate; undefined for context elements. */
  shape?: EditableShape;
}

/**
 * Facility map authoring canvas. The visuals ARE the shared renderer
 * (FacilityMapSvg) — admins manipulate the same illustrated pools/courts
 * visitors will see, not wireframe stand-ins — with an editing overlay of
 * transparent hit areas and, on the selected unit, handles for rotate
 * (top), resize (bottom-right), duplicate and delete.
 *
 * Editing ergonomics: moves and resizes snap to a half-meter grid and to
 * other shapes' edges/centers (which draw a fleeting alignment guide);
 * rotation snaps to 15° steps. With a unit selected, arrow keys nudge
 * (Shift = full grid cell), Delete removes, Ctrl/Cmd+D duplicates, Escape
 * deselects. Every gesture end calls onCommit so the owner can push an
 * undo step; live drag frames go through onChange only.
 */
export default function ShapeCanvas({
  canvasWidth,
  canvasHeight,
  shapes,
  contextElements,
  spaces,
  onChange,
  onCommit,
  onDuplicate,
}: ShapeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });

  const spaceNameById = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces]);

  // ---- Render-model mapping (visuals via the shared engine) ----------------

  const renderShapes: RenderShape[] = shapes.map((s) => ({
    key: s.key,
    spaceId: s.space_id,
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    rotation: s.rotation,
    presetKey: s.presetKey,
    displayName: s.label ?? spaceNameById.get(s.space_id) ?? "Unassigned",
    groupId: s.groupId,
    laneIndex: s.laneIndex,
  }));

  const renderContext: RenderContextElement[] = contextElements.map((c) => ({
    key: c.key,
    kind: c.kind,
    x: c.x,
    y: c.y,
    width: c.width,
    height: c.height,
    rotation: c.rotation,
    label: c.label,
  }));

  // ---- Edit units ----------------------------------------------------------

  const units: EditUnit[] = useMemo(() => {
    const result: EditUnit[] = [];
    const seenGroups = new Set<string>();
    for (const s of shapes) {
      if (s.groupId === null) {
        result.push({
          unitKey: s.key,
          kind: "shape",
          rect: s,
          memberKeys: new Set([s.key]),
          label: s.label ?? spaceNameById.get(s.space_id) ?? "Shape",
          shape: s,
        });
      } else if (!seenGroups.has(s.groupId)) {
        seenGroups.add(s.groupId);
        const members = shapes.filter((m) => m.groupId === s.groupId);
        result.push({
          unitKey: `group:${s.groupId}`,
          kind: "group",
          rect: s,
          memberKeys: new Set(members.map((m) => m.key)),
          label: "Pool",
          shape: s,
        });
      }
    }
    for (const c of contextElements) {
      result.push({
        unitKey: c.key,
        kind: "context",
        rect: c,
        memberKeys: new Set([c.key]),
        label: c.label ?? (c.kind === "entrance" ? "Entrance" : "Zone"),
      });
    }
    return result;
  }, [shapes, contextElements, spaceNameById]);

  const selectedUnit = units.find((u) => u.unitKey === selectedKey) ?? null;

  // ---- Shared update plumbing ---------------------------------------------

  function applyToUnit(unit: EditUnit, patch: Partial<EditableShape & EditableContextElement>) {
    if (unit.kind === "context") {
      onChange(
        shapes,
        contextElements.map((c) => (unit.memberKeys.has(c.key) ? { ...c, ...patch } : c))
      );
    } else {
      onChange(
        shapes.map((s) => (unit.memberKeys.has(s.key) ? { ...s, ...patch } : s)),
        contextElements
      );
    }
  }

  function removeUnit(unit: EditUnit) {
    if (unit.kind === "context") {
      onChange(shapes, contextElements.filter((c) => !unit.memberKeys.has(c.key)));
    } else {
      onChange(shapes.filter((s) => !unit.memberKeys.has(s.key)), contextElements);
    }
    setSelectedKey(null);
    onCommit();
  }

  function pointFromEvent(e: { clientX: number; clientY: number }): Point {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  // ---- Snap targets --------------------------------------------------------

  function buildSnapTargets(activeUnit: EditUnit) {
    const gridStepX = GRID_METERS / canvasWidth;
    const gridStepY = GRID_METERS / canvasHeight;
    const gridX: number[] = [];
    const gridY: number[] = [];
    for (let v = 0; v <= 1.0001; v += gridStepX) gridX.push(v);
    for (let v = 0; v <= 1.0001; v += gridStepY) gridY.push(v);

    const alignX: number[] = [];
    const alignY: number[] = [];
    for (const u of units) {
      if (u.unitKey === activeUnit.unitKey) continue;
      alignX.push(u.rect.x, u.rect.x + u.rect.width, u.rect.x + u.rect.width / 2);
      alignY.push(u.rect.y, u.rect.y + u.rect.height, u.rect.y + u.rect.height / 2);
    }
    return { gridX, gridY, alignX, alignY };
  }

  function snapThresholds() {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: SNAP_PX / rect.width, y: SNAP_PX / rect.height };
  }

  /** Snap one axis of a moving rect: try align targets (guide shown), then grid. */
  function snapAxis(
    pos: number,
    size: number,
    alignTargets: number[],
    gridTargets: number[],
    threshold: number
  ): { pos: number; guide: number | null } {
    const anchors = [pos, pos + size, pos + size / 2];
    let best: { pos: number; guide: number | null; delta: number } | null = null;
    for (let i = 0; i < anchors.length; i++) {
      const aligned = snapValue(anchors[i], alignTargets, threshold);
      if (aligned.snappedTo !== null) {
        const delta = Math.abs(aligned.value - anchors[i]);
        if (!best || delta < best.delta) {
          best = { pos: pos + (aligned.value - anchors[i]), guide: aligned.snappedTo, delta };
        }
      }
    }
    if (best) return { pos: best.pos, guide: best.guide };
    const gridded = snapValue(pos, gridTargets, threshold);
    return { pos: gridded.value, guide: null };
  }

  // ---- Gestures ------------------------------------------------------------

  function startMove(e: React.PointerEvent, unit: EditUnit) {
    e.stopPropagation();
    setSelectedKey(unit.unitKey);
    const p = pointFromEvent(e);
    const grabOffsetX = p.x - unit.rect.x;
    const grabOffsetY = p.y - unit.rect.y;
    const { gridX, gridY, alignX, alignY } = buildSnapTargets(unit);
    const threshold = snapThresholds();
    const { width, height } = unit.rect;
    let moved = false;

    function handleMove(moveEvent: PointerEvent) {
      moved = true;
      const mp = pointFromEvent(moveEvent);
      const rawX = Math.min(1 - width, Math.max(0, mp.x - grabOffsetX));
      const rawY = Math.min(1 - height, Math.max(0, mp.y - grabOffsetY));
      const sx = snapAxis(rawX, width, alignX, gridX, threshold.x);
      const sy = snapAxis(rawY, height, alignY, gridY, threshold.y);
      setGuides({ v: sx.guide, h: sy.guide });
      applyToUnit(unit, {
        x: Math.min(1 - width, Math.max(0, sx.pos)),
        y: Math.min(1 - height, Math.max(0, sy.pos)),
      });
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      setGuides({ v: null, h: null });
      if (moved) onCommit();
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function startResize(e: React.PointerEvent, unit: EditUnit) {
    e.stopPropagation();
    const { gridX, gridY } = buildSnapTargets(unit);
    const threshold = snapThresholds();
    const startRect = { ...unit.rect };

    function handleMove(moveEvent: PointerEvent) {
      const mp = pointFromEvent(moveEvent);
      const next = resizeFromOppositeCorner(startRect, startRect.rotation, mp, MIN_SIZE);
      // Grid-snap the far edges only while unrotated — snapping a rotated
      // rect's axis-aligned edge would fight the rotation math.
      if (startRect.rotation === 0) {
        const right = snapValue(next.x + next.width, gridX, threshold.x);
        const bottom = snapValue(next.y + next.height, gridY, threshold.y);
        next.width = Math.max(MIN_SIZE, right.value - next.x);
        next.height = Math.max(MIN_SIZE, bottom.value - next.y);
      }
      applyToUnit(unit, next);
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      onCommit();
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function startRotate(e: React.PointerEvent, unit: EditUnit) {
    e.stopPropagation();
    const containerRect = containerRef.current!.getBoundingClientRect();

    function handleMove(moveEvent: PointerEvent) {
      const c = center(unit.rect);
      const centerScreen = {
        x: containerRect.left + c.x * containerRect.width,
        y: containerRect.top + c.y * containerRect.height,
      };
      const raw = clampRotation(
        angleFromCenter(centerScreen, { x: moveEvent.clientX, y: moveEvent.clientY })
      );
      applyToUnit(unit, { rotation: snapAngle(raw, ROTATION_SNAP_STEP, ROTATION_SNAP_THRESHOLD) });
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      onCommit();
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  // ---- Keyboard ------------------------------------------------------------

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!selectedUnit) return;
    const stepX = (e.shiftKey ? GRID_METERS : NUDGE_METERS) / canvasWidth;
    const stepY = (e.shiftKey ? GRID_METERS : NUDGE_METERS) / canvasHeight;
    const { rect } = selectedUnit;

    const nudge = (dx: number, dy: number) => {
      e.preventDefault();
      applyToUnit(selectedUnit, {
        x: Math.min(1 - rect.width, Math.max(0, rect.x + dx)),
        y: Math.min(1 - rect.height, Math.max(0, rect.y + dy)),
      });
      onCommit();
    };

    switch (e.key) {
      case "ArrowLeft":
        return nudge(-stepX, 0);
      case "ArrowRight":
        return nudge(stepX, 0);
      case "ArrowUp":
        return nudge(0, -stepY);
      case "ArrowDown":
        return nudge(0, stepY);
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return removeUnit(selectedUnit);
      case "Escape":
        return setSelectedKey(null);
      case "d":
      case "D":
        if ((e.ctrlKey || e.metaKey) && selectedUnit.shape) {
          e.preventDefault();
          onDuplicate(selectedUnit.shape);
        }
        return;
    }
  }

  // ---- Render --------------------------------------------------------------

  const isEmpty = shapes.length === 0 && contextElements.length === 0;
  const assignedSpaceIds = new Set(shapes.map((s) => s.space_id));

  return (
    <div>
      <div
        ref={containerRef}
        data-shape-canvas="true"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={() => setSelectedKey(null)}
        aria-label="Facility map canvas — select a shape, then use arrow keys to nudge, Delete to remove"
        className="relative w-full rounded-xl overflow-hidden select-none touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
      >
        <FacilityMapSvg
          className="absolute inset-0 pointer-events-none"
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          shapes={renderShapes}
          contextElements={renderContext}
        />

        {/* Alignment guides */}
        {guides.v !== null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-blue-500/70 pointer-events-none"
            style={{ left: `${guides.v * 100}%` }}
          />
        )}
        {guides.h !== null && (
          <div
            className="absolute left-0 right-0 h-px bg-blue-500/70 pointer-events-none"
            style={{ top: `${guides.h * 100}%` }}
          />
        )}

        {/* Editing overlay — transparent hit areas + handles on selection. */}
        {units.map((unit) => {
          const isSelected = unit.unitKey === selectedKey;
          return (
            <div
              key={unit.unitKey}
              onPointerDown={(e) => startMove(e, unit)}
              className={`absolute cursor-move ${isSelected ? "z-10" : ""}`}
              style={{
                left: `${unit.rect.x * 100}%`,
                top: `${unit.rect.y * 100}%`,
                width: `${unit.rect.width * 100}%`,
                height: `${unit.rect.height * 100}%`,
                transform: `rotate(${unit.rect.rotation}deg)`,
                transformOrigin: "center",
              }}
              role="button"
              aria-label={`${unit.label} — drag to move`}
            >
              {isSelected && (
                <>
                  <div className="absolute -inset-0.5 border-2 border-blue-500 border-dashed rounded pointer-events-none" />

                  <div className="absolute -top-3 -right-3 flex gap-1">
                    {unit.shape && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDuplicate(unit.shape!);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-300 shadow-sm"
                        aria-label={`Duplicate ${unit.label}`}
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeUnit(unit);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-300 text-gray-500 hover:text-red-600 hover:border-red-300 shadow-sm"
                      aria-label={`Remove ${unit.label}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <div
                    onPointerDown={(e) => startRotate(e, unit)}
                    className="absolute -top-7 left-1/2 -translate-x-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-white border border-gray-300 text-gray-500 cursor-grab shadow-sm"
                    aria-label={`Rotate ${unit.label}`}
                  >
                    <RotateCw className="w-3 h-3" />
                  </div>

                  <div
                    onPointerDown={(e) => startResize(e, unit)}
                    className="absolute -bottom-2 -right-2 w-4 h-4 rounded-full bg-blue-600 border-2 border-white cursor-nwse-resize shadow-sm"
                    aria-label={`Resize ${unit.label}`}
                  />
                </>
              )}
            </div>
          );
        })}

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center px-6">
              <p className="text-sm font-semibold text-gray-500">Build your facility</p>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">
                Drag a pool, court, or room from the palette below onto this canvas. Add zones like
                &ldquo;Lobby&rdquo; and an entrance marker so visitors can orient themselves.
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Click a shape to select it — drag to move, use the handles to rotate and resize, arrow keys
        to nudge. Shapes snap to a 0.5&nbsp;m grid and to each other&apos;s edges.
      </p>

      {(shapes.length > 0 || contextElements.length > 0) && (
        <div className="mt-4 space-y-2">
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
      )}
    </div>
  );
}

/** Converts a client-space point to a 0..1 fraction of the given canvas element's rect. */
export function pointToCanvasFraction(canvasEl: HTMLElement, clientX: number, clientY: number): Point {
  const rect = canvasEl.getBoundingClientRect();
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}
