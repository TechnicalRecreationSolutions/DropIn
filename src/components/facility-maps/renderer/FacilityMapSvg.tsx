"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RenderShape, RenderContextElement, StatusBySpaceId } from "./types";
import { MAP_COLORS, shapeFamily } from "./style";
import {
  PoolShape,
  LeisurePoolShape,
  CourtShape,
  RinkShape,
  GymFloorShape,
  ClimbingWallShape,
  RoomShape,
  ContextElement,
  type UnitRect,
  type DefRefs,
} from "./shapes";

interface FacilityMapSvgProps {
  /** Real-world canvas extent in meters (facility_maps.canvas_width/height). */
  canvasWidth: number;
  canvasHeight: number;
  shapes: RenderShape[];
  contextElements?: RenderContextElement[];
  statusBySpaceId?: StatusBySpaceId;
  selectedSpaceId?: string | null;
  /** Omit to render a non-interactive map (e.g. a static preview). */
  onSpaceClick?: (spaceId: string) => void;
  className?: string;
}

/** Fixed viewBox width — all geometry scales into this regardless of canvas meters. */
const VIEW_W = 1000;
/** Inset of the building shell from the canvas edge, in viewBox units. */
const SHELL_INSET = 8;

/**
 * The shared facility-map rendering engine ("soft depth" visual language):
 * one SVG that both the public floorplan view and the map builder draw
 * through, so the two can never diverge. Turns normalized hotspot rects
 * into illustrated spaces — gradient water with lane ropes, material courts
 * with markings, pale rooms — inside a building shell, with live/soon
 * status washes from `statusBySpaceId` (absence = free).
 *
 * Geometry: a fixed 1000-unit-wide viewBox (height follows the canvas's
 * real-world aspect ratio), so font/stroke sizes are consistent fractions
 * of the rendered map across facilities of any physical size. An internal
 * ResizeObserver measures rendered pixels per unit and feeds detail
 * density: court markings, lane text, and status lines drop out before
 * they'd become illegible smudges on small screens.
 */
export default function FacilityMapSvg({
  canvasWidth,
  canvasHeight,
  shapes,
  contextElements = [],
  statusBySpaceId,
  selectedSpaceId,
  onSpaceClick,
  className,
}: FacilityMapSvgProps) {
  const viewH = (VIEW_W * canvasHeight) / canvasWidth;

  const containerRef = useRef<HTMLDivElement>(null);
  const [pxWidth, setPxWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setPxWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const pxPerUnit = (pxWidth || 640) / VIEW_W;

  // Gradient ids must be unique per mounted instance — the builder and a
  // preview can render two maps on one page.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientIds = {
    water: `fm-water-${uid}`,
    wood: `fm-wood-${uid}`,
    acrylicGreen: `fm-ag-${uid}`,
    acrylicBlue: `fm-ab-${uid}`,
    floor: `fm-floor-${uid}`,
  };
  const defs: DefRefs = {
    water: `url(#${gradientIds.water})`,
    wood: `url(#${gradientIds.wood})`,
    acrylicGreen: `url(#${gradientIds.acrylicGreen})`,
    acrylicBlue: `url(#${gradientIds.acrylicBlue})`,
  };

  function toUnits(s: { x: number; y: number; width: number; height: number }): UnitRect {
    return { x: s.x * VIEW_W, y: s.y * viewH, w: s.width * VIEW_W, h: s.height * viewH };
  }

  // One render unit per standalone shape or lane group, interleaved and
  // sorted large-to-small so a small studio overlapping a big pool or court
  // stays visible and clickable on top of it regardless of unit kind.
  const standalone = shapes.filter((s) => s.groupId === null);
  const groupIds = [...new Set(shapes.filter((s) => s.groupId !== null).map((s) => s.groupId!))];
  const groups = groupIds.map((groupId) => ({
    groupId,
    members: shapes
      .filter((s) => s.groupId === groupId)
      .sort((a, b) => (a.laneIndex ?? 0) - (b.laneIndex ?? 0)),
  }));
  const renderUnits: { key: string; area: number; render: () => React.ReactNode }[] = [];

  return (
    <div ref={containerRef} className={className}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${viewH}`}
        role="group"
        aria-label="Facility map"
        style={{ display: "block", width: "100%", height: "auto" }}
      >
        <defs>
          <linearGradient id={gradientIds.floor} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={MAP_COLORS.floorTop} />
            <stop offset="1" stopColor={MAP_COLORS.floorBottom} />
          </linearGradient>
          <linearGradient id={gradientIds.water} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={MAP_COLORS.waterTop} />
            <stop offset="1" stopColor={MAP_COLORS.waterBottom} />
          </linearGradient>
          <linearGradient id={gradientIds.wood} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={MAP_COLORS.woodLight} />
            <stop offset="1" stopColor={MAP_COLORS.woodDark} />
          </linearGradient>
          <linearGradient id={gradientIds.acrylicGreen} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={MAP_COLORS.acrylicGreenLight} />
            <stop offset="1" stopColor={MAP_COLORS.acrylicGreenDark} />
          </linearGradient>
          <linearGradient id={gradientIds.acrylicBlue} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={MAP_COLORS.acrylicBlueLight} />
            <stop offset="1" stopColor={MAP_COLORS.acrylicBlueDark} />
          </linearGradient>
        </defs>

        {/* Floor + building shell — the "you are inside a building" anchor. */}
        <rect x={0} y={0} width={VIEW_W} height={viewH} fill={`url(#${gradientIds.floor})`} />
        <rect
          x={SHELL_INSET}
          y={SHELL_INSET}
          width={VIEW_W - SHELL_INSET * 2}
          height={viewH - SHELL_INSET * 2}
          rx={12}
          fill={MAP_COLORS.shellFill}
          stroke={MAP_COLORS.shellStroke}
          strokeWidth={3}
        />

        {contextElements.map((element) => (
          <ContextElement key={element.key} element={element} rect={toUnits(element)} pxPerUnit={pxPerUnit} />
        ))}

        {(() => {
          for (const shape of standalone) {
            const rect = toUnits(shape);
            const family = shapeFamily(shape.presetKey);
            const common = {
              shape,
              rect,
              status: statusBySpaceId?.get(shape.spaceId),
              selected: shape.spaceId === selectedSpaceId,
              pxPerUnit,
              defs,
              onClick: onSpaceClick,
            };
            renderUnits.push({
              key: shape.key,
              area: shape.width * shape.height,
              render: () => {
                if (family === "leisure-pool") return <LeisurePoolShape key={shape.key} {...common} />;
                if (family === "pool") {
                  // A standalone pool (single-lane, or a backfilled legacy
                  // row): render as a one-lane pool so it still reads as water.
                  return (
                    <PoolShape
                      key={shape.key}
                      rect={rect}
                      rotation={shape.rotation}
                      lanes={[{ shape, status: common.status }]}
                      selectedSpaceId={selectedSpaceId}
                      pxPerUnit={pxPerUnit}
                      defs={defs}
                      onLaneClick={onSpaceClick}
                    />
                  );
                }
                if (family.startsWith("court-")) return <CourtShape key={shape.key} {...common} family={family} />;
                if (family === "rink") return <RinkShape key={shape.key} {...common} />;
                if (family === "gym-floor") return <GymFloorShape key={shape.key} {...common} />;
                if (family === "climbing-wall") return <ClimbingWallShape key={shape.key} {...common} />;
                return <RoomShape key={shape.key} {...common} />;
              },
            });
          }

          for (const { groupId, members } of groups) {
            if (members.length === 0) continue;
            const outer = members[0]; // every member shares the identical outer rect
            renderUnits.push({
              key: groupId,
              area: outer.width * outer.height,
              render: () => (
                <PoolShape
                  key={groupId}
                  rect={toUnits(outer)}
                  rotation={outer.rotation}
                  lanes={members.map((m) => ({ shape: m, status: statusBySpaceId?.get(m.spaceId) }))}
                  selectedSpaceId={selectedSpaceId}
                  pxPerUnit={pxPerUnit}
                  defs={defs}
                  onLaneClick={onSpaceClick}
                />
              ),
            });
          }

          return renderUnits.sort((a, b) => b.area - a.area).map((u) => u.render());
        })()}
      </svg>
    </div>
  );
}
