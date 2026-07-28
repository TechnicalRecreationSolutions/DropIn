"use client";

import type { RenderShape, RenderContextElement, SpaceStatusInfo } from "./types";
import {
  MAP_COLORS,
  SHAPE_SHADOW,
  LIVE_GLOW,
  clamp,
  courtMaterial,
  type ShapeFamily,
} from "./style";

/** A hotspot's rect converted to viewBox units by FacilityMapSvg. */
export interface UnitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** url(#...) references into FacilityMapSvg's <defs> gradients. */
export interface DefRefs {
  water: string;
  wood: string;
  acrylicGreen: string;
  acrylicBlue: string;
}

interface StandaloneShapeProps {
  shape: RenderShape;
  rect: UnitRect;
  status?: SpaceStatusInfo;
  selected: boolean;
  /** Rendered device pixels per viewBox unit — drives detail density. */
  pxPerUnit: number;
  defs: DefRefs;
  onClick?: (spaceId: string) => void;
}

function centerOf(rect: UnitRect) {
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 };
}

/**
 * Font size in viewBox units for a desired on-screen pixel size — text must
 * be sized against rendered pixels, not viewBox units, or phone-size maps
 * get 5px labels. `capUnits` keeps text from outgrowing its shape when the
 * map renders very small.
 */
function fsUnits(desiredPx: number, pxPerUnit: number, capUnits: number): number {
  return Math.min(desiredPx / pxPerUnit, capUnits);
}

/** Props making an SVG group act as a button (viewer) or inert (builder preview). */
function interactionProps(shape: RenderShape, onClick?: (spaceId: string) => void) {
  if (!onClick) return {};
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": shape.displayName,
    style: { cursor: "pointer" },
    onClick: () => onClick(shape.spaceId),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick(shape.spaceId);
      }
    },
  };
}

/** Dashed ink outline marking the currently-selected space. */
function SelectionRing({ rect, r }: { rect: UnitRect; r: number }) {
  return (
    <rect
      x={rect.x - 3}
      y={rect.y - 3}
      width={rect.w + 6}
      height={rect.h + 6}
      rx={r + 3}
      fill="none"
      stroke={MAP_COLORS.ink}
      strokeWidth={2}
      strokeDasharray="7 5"
      pointerEvents="none"
    />
  );
}

/**
 * Centered name + optional status lines, counter-rotated so text stays
 * horizontal whatever the shape's rotation. `onDark` picks text colors for
 * water/wood/acrylic vs. pale room floors.
 */
function LabelBlock({
  rect,
  rotation,
  name,
  status,
  pxPerUnit,
  onDark,
}: {
  rect: UnitRect;
  rotation: number;
  name: string;
  status?: SpaceStatusInfo;
  pxPerUnit: number;
  onDark: boolean;
}) {
  const { cx, cy } = centerOf(rect);
  const pxWidth = rect.w * pxPerUnit;
  if (pxWidth < 44) return null;

  const nameFs = fsUnits(clamp(12, rect.h * pxPerUnit * 0.22, 17), pxPerUnit, rect.h * 0.3);
  const subFs = nameFs * 0.8;
  const showStatusLines = !!status && pxWidth >= 120 && rect.h * pxPerUnit >= 60;

  const nameFill = onDark ? MAP_COLORS.waterText : MAP_COLORS.ink;
  const subFill = onDark ? MAP_COLORS.waterTextDim : MAP_COLORS.inkSoft;
  const titleFill = !onDark && status?.status === "soon" ? MAP_COLORS.soonText : subFill;

  const nameY = showStatusLines ? cy - subFs * 0.9 : cy;

  return (
    <g transform={rotation ? `rotate(${-rotation} ${cx} ${cy})` : undefined} pointerEvents="none">
      <text
        x={cx}
        y={nameY}
        fontSize={nameFs}
        fontWeight={700}
        fill={nameFill}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {name}
      </text>
      {showStatusLines && status && (
        <>
          <text
            x={cx}
            y={nameY + nameFs * 0.95}
            fontSize={subFs}
            fontWeight={600}
            fill={titleFill}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {status.title}
          </text>
          <text
            x={cx}
            y={nameY + nameFs * 0.95 + subFs * 1.15}
            fontSize={subFs * 0.9}
            fill={subFill}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {status.timeLabel}
          </text>
        </>
      )}
    </g>
  );
}

/**
 * Accent/amber wash + stroke laid over a shape's footprint. On water, the
 * "soon" state brightens with a warm white instead of amber — an amber wash
 * over blue water blends to a muddy green.
 */
function StatusOverlay({
  rect,
  r,
  status,
  onWater = false,
}: {
  rect: UnitRect;
  r: number;
  status?: SpaceStatusInfo;
  onWater?: boolean;
}) {
  if (!status) return null;
  const live = status.status === "live";
  const soonFill = onWater ? "#FFF6E0" : MAP_COLORS.soonFill;
  return (
    <rect
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      rx={r}
      fill={live ? MAP_COLORS.accent : soonFill}
      fillOpacity={live ? (onWater ? 0.4 : 0.26) : onWater ? 0.5 : 0.2}
      stroke={live ? MAP_COLORS.accent : MAP_COLORS.soonStroke}
      strokeWidth={live ? 3 : 2.5}
      pointerEvents="none"
    />
  );
}

function shadowFilter(status?: SpaceStatusInfo): string {
  return status?.status === "live" ? `${SHAPE_SHADOW} ${LIVE_GLOW}` : SHAPE_SHADOW;
}

// ---------------------------------------------------------------------------
// Multi-lane pool
// ---------------------------------------------------------------------------

export interface PoolLane {
  shape: RenderShape;
  status?: SpaceStatusInfo;
}

/**
 * A multi-lane pool group: light deck, gradient water, dashed lane ropes at
 * stripe boundaries, and per-lane status washes. Lanes divide the water
 * area top-to-bottom in the group's local (unrotated) frame, mirroring
 * laneRectsWithinGroup — the whole group rotates as one via CSS transform,
 * so stripes never need their own rotation math.
 */
export function PoolShape({
  rect,
  rotation,
  lanes,
  selectedSpaceId,
  pxPerUnit,
  defs,
  onLaneClick,
}: {
  rect: UnitRect;
  rotation: number;
  lanes: PoolLane[];
  selectedSpaceId?: string | null;
  pxPerUnit: number;
  defs: DefRefs;
  onLaneClick?: (spaceId: string) => void;
}) {
  const { cx, cy } = centerOf(rect);
  const anyLive = lanes.some((l) => l.status?.status === "live");
  const deckR = clamp(6, Math.min(rect.w, rect.h) * 0.08, 14);
  const pad = clamp(4, Math.min(rect.w, rect.h) * 0.06, 12);
  const water: UnitRect = {
    x: rect.x + pad,
    y: rect.y + pad,
    w: rect.w - pad * 2,
    h: rect.h - pad * 2,
  };
  const stripeH = water.h / lanes.length;
  const ropeWidth = clamp(1.5, stripeH * 0.06, 3);
  const stripePxW = water.w * pxPerUnit;
  const stripePxH = stripeH * pxPerUnit;
  const laneFs = fsUnits(clamp(10, stripePxH * 0.48, 15), pxPerUnit, stripeH * 0.62);

  return (
    <g
      transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}
      style={{ filter: anyLive ? `${SHAPE_SHADOW} ${LIVE_GLOW}` : SHAPE_SHADOW }}
    >
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={deckR} fill={MAP_COLORS.deck} />
      <rect x={water.x} y={water.y} width={water.w} height={water.h} rx={deckR * 0.6} fill={defs.water} />

      {lanes.map((lane, i) => {
        const stripe: UnitRect = { x: water.x, y: water.y + i * stripeH, w: water.w, h: stripeH };
        const status = lane.status;
        const stripeCy = stripe.y + stripe.h / 2;
        const showSession =
          !!status && stripePxW >= 160 && stripePxH >= 13;
        const sessionText =
          status && (stripePxW >= 250 ? `${status.title} · ${status.timeLabel}` : status.title);
        const selected = lane.shape.spaceId === selectedSpaceId;

        const live = status?.status === "live";
        return (
          <g key={lane.shape.key} {...interactionProps(lane.shape, onLaneClick)}>
            {/* full-stripe hit target, visible only via its status wash */}
            <rect
              x={stripe.x}
              y={stripe.y}
              width={stripe.w}
              height={stripe.h}
              fill={status ? (live ? MAP_COLORS.accent : "#FFF6E0") : "transparent"}
              fillOpacity={status ? (live ? 0.45 : 0.5) : 0}
            />
            {status && (
              <rect
                x={stripe.x + 1}
                y={stripe.y + 1}
                width={stripe.w - 2}
                height={stripe.h - 2}
                fill="none"
                stroke={live ? "rgba(255,255,255,0.9)" : MAP_COLORS.soonStroke}
                strokeWidth={live ? 1.5 : 2}
                pointerEvents="none"
              />
            )}
            {i > 0 && (
              <line
                x1={stripe.x}
                y1={stripe.y}
                x2={stripe.x + stripe.w}
                y2={stripe.y}
                stroke={MAP_COLORS.rope}
                strokeWidth={ropeWidth}
                strokeDasharray={`${ropeWidth} ${ropeWidth * 3.5}`}
                strokeLinecap="round"
                pointerEvents="none"
              />
            )}
            {stripePxH >= 11 && (
              <g
                transform={rotation ? `rotate(${-rotation} ${stripe.x + laneFs * 0.8} ${stripeCy})` : undefined}
                pointerEvents="none"
              >
                <text
                  x={stripe.x + laneFs * 0.8}
                  y={stripeCy}
                  fontSize={laneFs}
                  fontWeight={700}
                  fill={
                    status?.status === "soon"
                      ? MAP_COLORS.soonText
                      : status
                        ? MAP_COLORS.waterText
                        : MAP_COLORS.waterTextDim
                  }
                  dominantBaseline="central"
                >
                  {lane.shape.displayName}
                </text>
              </g>
            )}
            {showSession && sessionText && (
              <g
                transform={rotation ? `rotate(${-rotation} ${stripe.x + stripe.w - laneFs * 0.8} ${stripeCy})` : undefined}
                pointerEvents="none"
              >
                <text
                  x={stripe.x + stripe.w - laneFs * 0.8}
                  y={stripeCy}
                  fontSize={laneFs * 0.9}
                  fontWeight={600}
                  fill={status?.status === "soon" ? MAP_COLORS.soonText : MAP_COLORS.waterText}
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {sessionText}
                </text>
              </g>
            )}
            {selected && <SelectionRing rect={stripe} r={0} />}
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Leisure pool
// ---------------------------------------------------------------------------

/** Free-form water: heavily rounded deck + water, label centered on the water. */
export function LeisurePoolShape({ shape, rect, status, selected, pxPerUnit, defs, onClick }: StandaloneShapeProps) {
  const { cx, cy } = centerOf(rect);
  const r = Math.min(rect.w, rect.h) * 0.32;
  const pad = clamp(4, Math.min(rect.w, rect.h) * 0.06, 12);

  return (
    <g
      transform={shape.rotation ? `rotate(${shape.rotation} ${cx} ${cy})` : undefined}
      style={{ filter: shadowFilter(status) }}
    >
      <g {...interactionProps(shape, onClick)}>
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={r} fill={MAP_COLORS.deck} />
        <rect
          x={rect.x + pad}
          y={rect.y + pad}
          width={rect.w - pad * 2}
          height={rect.h - pad * 2}
          rx={Math.max(0, r - pad)}
          fill={defs.water}
        />
        <StatusOverlay rect={rect} r={r} status={status} onWater />
        <LabelBlock
          rect={rect}
          rotation={shape.rotation}
          name={shape.displayName}
          status={status}
          pxPerUnit={pxPerUnit}
          onDark
        />
        {selected && <SelectionRing rect={rect} r={r} />}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Courts
// ---------------------------------------------------------------------------

/** Court markings in the shape's local frame — simplified, recognition-level, not regulation diagrams. */
function CourtMarkings({ rect, family, strokeW }: { rect: UnitRect; family: ShapeFamily; strokeW: number }) {
  const { x, y, w, h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const common = {
    stroke: MAP_COLORS.marking,
    strokeWidth: strokeW,
    fill: "none" as const,
    pointerEvents: "none" as const,
  };

  switch (family) {
    case "court-basketball": {
      const keyW = w * 0.17;
      const keyH = h * 0.42;
      const r = Math.min(h * 0.21, w * 0.12);
      return (
        <g {...common}>
          <line x1={cx} y1={y} x2={cx} y2={y + h} />
          <circle cx={cx} cy={cy} r={r} />
          <rect x={x} y={cy - keyH / 2} width={keyW} height={keyH} />
          <path d={`M ${x + keyW} ${cy - keyH / 2} a ${keyH / 2} ${keyH / 2} 0 0 1 0 ${keyH}`} />
          <rect x={x + w - keyW} y={cy - keyH / 2} width={keyW} height={keyH} />
          <path d={`M ${x + w - keyW} ${cy + keyH / 2} a ${keyH / 2} ${keyH / 2} 0 0 1 0 ${-keyH}`} />
        </g>
      );
    }
    case "court-tennis": {
      const alley = h * 0.13;
      const svc = w * 0.3;
      return (
        <g {...common}>
          <line x1={cx} y1={y} x2={cx} y2={y + h} strokeWidth={strokeW * 1.4} />
          <line x1={x} y1={y + alley} x2={x + w} y2={y + alley} />
          <line x1={x} y1={y + h - alley} x2={x + w} y2={y + h - alley} />
          <line x1={x + svc} y1={y + alley} x2={x + svc} y2={y + h - alley} />
          <line x1={x + w - svc} y1={y + alley} x2={x + w - svc} y2={y + h - alley} />
          <line x1={x + svc} y1={cy} x2={x + w - svc} y2={cy} />
        </g>
      );
    }
    case "court-volleyball": {
      return (
        <g {...common}>
          <line x1={cx} y1={y} x2={cx} y2={y + h} strokeWidth={strokeW * 1.4} />
          <line x1={x + w * 0.333} y1={y} x2={x + w * 0.333} y2={y + h} strokeDasharray={`${strokeW * 3} ${strokeW * 3}`} />
          <line x1={x + w * 0.667} y1={y} x2={x + w * 0.667} y2={y + h} strokeDasharray={`${strokeW * 3} ${strokeW * 3}`} />
        </g>
      );
    }
    case "court-badminton": {
      const alley = h * 0.1;
      const svc = w * 0.35;
      return (
        <g {...common}>
          <line x1={cx} y1={y} x2={cx} y2={y + h} strokeWidth={strokeW * 1.4} />
          <line x1={x} y1={y + alley} x2={x + w} y2={y + alley} />
          <line x1={x} y1={y + h - alley} x2={x + w} y2={y + h - alley} />
          <line x1={x + svc} y1={y} x2={x + svc} y2={y + h} />
          <line x1={x + w - svc} y1={y} x2={x + w - svc} y2={y + h} />
          <line x1={x} y1={cy} x2={x + svc} y2={cy} />
          <line x1={x + w - svc} y1={cy} x2={x + w} y2={cy} />
        </g>
      );
    }
    case "court-pickleball": {
      const kitchen = w * 0.16;
      return (
        <g {...common}>
          <line x1={cx} y1={y} x2={cx} y2={y + h} strokeWidth={strokeW * 1.4} />
          <line x1={cx - kitchen} y1={y} x2={cx - kitchen} y2={y + h} />
          <line x1={cx + kitchen} y1={y} x2={cx + kitchen} y2={y + h} />
          <line x1={x} y1={cy} x2={cx - kitchen} y2={cy} />
          <line x1={cx + kitchen} y1={cy} x2={x + w} y2={cy} />
        </g>
      );
    }
    default:
      return null;
  }
}

/** A court: material floor (wood or acrylic), white markings, status wash. */
export function CourtShape({
  shape,
  rect,
  status,
  selected,
  pxPerUnit,
  defs,
  onClick,
  family,
}: StandaloneShapeProps & { family: ShapeFamily }) {
  const { cx, cy } = centerOf(rect);
  const r = clamp(4, Math.min(rect.w, rect.h) * 0.05, 10);
  const material = courtMaterial(family);
  const fill =
    material === "wood" ? defs.wood : material === "acrylicGreen" ? defs.acrylicGreen : defs.acrylicBlue;
  const showMarkings = rect.w * pxPerUnit >= 110;
  const strokeW = clamp(1.2, rect.w * 0.006, 3);

  return (
    <g
      transform={shape.rotation ? `rotate(${shape.rotation} ${cx} ${cy})` : undefined}
      style={{ filter: shadowFilter(status) }}
    >
      <g {...interactionProps(shape, onClick)}>
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={r} fill={fill} />
        <rect
          x={rect.x + strokeW * 2}
          y={rect.y + strokeW * 2}
          width={rect.w - strokeW * 4}
          height={rect.h - strokeW * 4}
          rx={Math.max(0, r - strokeW * 2)}
          fill="none"
          stroke={MAP_COLORS.marking}
          strokeWidth={strokeW}
          pointerEvents="none"
        />
        {showMarkings && <CourtMarkings rect={rect} family={family} strokeW={strokeW} />}
        <StatusOverlay rect={rect} r={r} status={status} />
        <LabelBlock
          rect={rect}
          rotation={shape.rotation}
          name={shape.displayName}
          status={status}
          pxPerUnit={pxPerUnit}
          onDark
        />
        {selected && <SelectionRing rect={rect} r={r} />}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Ice rink
// ---------------------------------------------------------------------------

/** An ice rink: pale ice, hockey-rounded corners, red/blue lines, center circle. */
export function RinkShape({ shape, rect, status, selected, pxPerUnit, onClick }: StandaloneShapeProps) {
  const { cx, cy } = centerOf(rect);
  const r = Math.min(rect.w, rect.h) * 0.22;
  const showMarkings = rect.w * pxPerUnit >= 110;
  const strokeW = clamp(1.2, rect.w * 0.006, 3);

  return (
    <g
      transform={shape.rotation ? `rotate(${shape.rotation} ${cx} ${cy})` : undefined}
      style={{ filter: shadowFilter(status) }}
    >
      <g {...interactionProps(shape, onClick)}>
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          rx={r}
          fill={MAP_COLORS.ice}
          stroke={MAP_COLORS.roomStroke}
          strokeWidth={1.5}
        />
        {showMarkings && (
          <g pointerEvents="none">
            <line x1={cx} y1={rect.y} x2={cx} y2={rect.y + rect.h} stroke={MAP_COLORS.iceLine} strokeWidth={strokeW * 1.4} />
            <line x1={rect.x + rect.w * 0.31} y1={rect.y} x2={rect.x + rect.w * 0.31} y2={rect.y + rect.h} stroke={MAP_COLORS.iceBlue} strokeWidth={strokeW * 1.2} />
            <line x1={rect.x + rect.w * 0.69} y1={rect.y} x2={rect.x + rect.w * 0.69} y2={rect.y + rect.h} stroke={MAP_COLORS.iceBlue} strokeWidth={strokeW * 1.2} />
            <circle cx={cx} cy={cy} r={Math.min(rect.h * 0.18, rect.w * 0.08)} fill="none" stroke={MAP_COLORS.iceLine} strokeWidth={strokeW} />
          </g>
        )}
        <StatusOverlay rect={rect} r={r} status={status} />
        <LabelBlock
          rect={rect}
          rotation={shape.rotation}
          name={shape.displayName}
          status={status}
          pxPerUnit={pxPerUnit}
          onDark={false}
        />
        {selected && <SelectionRing rect={rect} r={r} />}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Gym floor
// ---------------------------------------------------------------------------

/** Multi-use hardwood: wood grain and a boundary line, deliberately no sport markings. */
export function GymFloorShape({ shape, rect, status, selected, pxPerUnit, defs, onClick }: StandaloneShapeProps) {
  const { cx, cy } = centerOf(rect);
  const r = clamp(4, Math.min(rect.w, rect.h) * 0.05, 10);
  const strokeW = clamp(1.2, rect.w * 0.006, 3);

  return (
    <g
      transform={shape.rotation ? `rotate(${shape.rotation} ${cx} ${cy})` : undefined}
      style={{ filter: shadowFilter(status) }}
    >
      <g {...interactionProps(shape, onClick)}>
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={r} fill={defs.wood} />
        <rect
          x={rect.x + strokeW * 2}
          y={rect.y + strokeW * 2}
          width={rect.w - strokeW * 4}
          height={rect.h - strokeW * 4}
          rx={Math.max(0, r - strokeW * 2)}
          fill="none"
          stroke={MAP_COLORS.marking}
          strokeWidth={strokeW}
          pointerEvents="none"
        />
        <StatusOverlay rect={rect} r={r} status={status} />
        <LabelBlock
          rect={rect}
          rotation={shape.rotation}
          name={shape.displayName}
          status={status}
          pxPerUnit={pxPerUnit}
          onDark
        />
        {selected && <SelectionRing rect={rect} r={r} />}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Climbing wall
// ---------------------------------------------------------------------------

const HOLD_COLORS = ["#D96A6A", "#E8B54C", "#6FA287", "#5E8FBF", "#9C7BC0"];

/** A climbing wall: stone panel scattered with colored hold dots (deterministic layout). */
export function ClimbingWallShape({ shape, rect, status, selected, pxPerUnit, onClick }: StandaloneShapeProps) {
  const { cx, cy } = centerOf(rect);
  const r = clamp(3, Math.min(rect.w, rect.h) * 0.08, 8);
  const showHolds = rect.w * pxPerUnit >= 80;

  // Deterministic pseudo-random holds — a tiny LCG so the wall looks the
  // same on every render without storing anything.
  const holds: { x: number; y: number; color: string }[] = [];
  if (showHolds) {
    const count = clamp(8, Math.round((rect.w * rect.h) / 900), 40);
    let seed = 7;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      holds.push({
        x: rect.x + rect.w * (0.06 + next() * 0.88),
        y: rect.y + rect.h * (0.15 + next() * 0.7),
        color: HOLD_COLORS[Math.floor(next() * HOLD_COLORS.length)],
      });
    }
  }
  const holdR = clamp(1.5, Math.min(rect.w, rect.h) * 0.035, 4);

  return (
    <g
      transform={shape.rotation ? `rotate(${shape.rotation} ${cx} ${cy})` : undefined}
      style={{ filter: shadowFilter(status) }}
    >
      <g {...interactionProps(shape, onClick)}>
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={r} fill={MAP_COLORS.stoneLight} />
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h * 0.12} rx={r} fill={MAP_COLORS.stoneDark} pointerEvents="none" />
        {holds.map((hold, i) => (
          <circle key={i} cx={hold.x} cy={hold.y} r={holdR} fill={hold.color} pointerEvents="none" />
        ))}
        <StatusOverlay rect={rect} r={r} status={status} />
        <LabelBlock
          rect={rect}
          rotation={shape.rotation}
          name={shape.displayName}
          status={status}
          pxPerUnit={pxPerUnit}
          onDark
        />
        {selected && <SelectionRing rect={rect} r={r} />}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Generic room
// ---------------------------------------------------------------------------

/** A studio/room: pale floor, quiet border, ink label. */
export function RoomShape({ shape, rect, status, selected, pxPerUnit, onClick }: StandaloneShapeProps) {
  const { cx, cy } = centerOf(rect);
  const r = clamp(4, Math.min(rect.w, rect.h) * 0.06, 10);

  return (
    <g
      transform={shape.rotation ? `rotate(${shape.rotation} ${cx} ${cy})` : undefined}
      style={{ filter: shadowFilter(status) }}
    >
      <g {...interactionProps(shape, onClick)}>
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          rx={r}
          fill={MAP_COLORS.roomFill}
          stroke={MAP_COLORS.roomStroke}
          strokeWidth={1.5}
        />
        <StatusOverlay rect={rect} r={r} status={status} />
        <LabelBlock
          rect={rect}
          rotation={shape.rotation}
          name={shape.displayName}
          status={status}
          pxPerUnit={pxPerUnit}
          onDark={false}
        />
        {selected && <SelectionRing rect={rect} r={r} />}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Context scenery
// ---------------------------------------------------------------------------

/** Non-interactive scenery: muted labeled zones and the entrance marker. */
export function ContextElement({ element, rect, pxPerUnit }: { element: RenderContextElement; rect: UnitRect; pxPerUnit: number }) {
  const { cx, cy } = centerOf(rect);

  if (element.kind === "entrance") {
    const barH = Math.min(rect.h, clamp(5, rect.h, 10));
    const barY = rect.y + rect.h - barH;
    const triW = clamp(8, rect.w * 0.2, 16);
    const label = (element.label ?? "Entrance").toUpperCase();
    return (
      <g transform={element.rotation ? `rotate(${element.rotation} ${cx} ${cy})` : undefined} pointerEvents="none">
        <rect x={rect.x} y={barY} width={rect.w} height={barH} rx={barH / 2} fill={MAP_COLORS.entrance} />
        <path
          d={`M ${cx} ${barY - triW * 1.1} l ${-triW / 2} ${triW * 0.9} h ${triW} z`}
          fill={MAP_COLORS.entrance}
        />
        {rect.w * pxPerUnit >= 56 && (
          <text
            x={cx}
            y={barY - triW * 1.5}
            fontSize={clamp(9, rect.w * 0.11, 13)}
            fontWeight={800}
            letterSpacing="0.08em"
            fill={MAP_COLORS.entrance}
            textAnchor="middle"
          >
            {label}
          </text>
        )}
      </g>
    );
  }

  const r = clamp(4, Math.min(rect.w, rect.h) * 0.08, 10);
  return (
    <g transform={element.rotation ? `rotate(${element.rotation} ${cx} ${cy})` : undefined} pointerEvents="none">
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={r} fill={MAP_COLORS.zoneFill} />
      {element.label && rect.w * pxPerUnit >= 48 && (
        <g transform={element.rotation ? `rotate(${-element.rotation} ${cx} ${cy})` : undefined}>
          <text
            x={cx}
            y={cy}
            fontSize={clamp(11, rect.h * 0.18, 16)}
            fontWeight={600}
            fill={MAP_COLORS.zoneText}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {element.label}
          </text>
        </g>
      )}
    </g>
  );
}

