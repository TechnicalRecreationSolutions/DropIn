"use client";

import { useId, type ReactNode } from "react";
import type { RenderShape, RenderContextElement, SpaceAlert, SpaceStatusInfo } from "./types";
import { MAP_COLORS, SURFACES, clamp, courtMaterial, type ShapeFamily, type Surface } from "./style";

/** A hotspot's rect converted to viewBox units by FacilityMapSvg. */
export interface UnitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StandaloneShapeProps {
  shape: RenderShape;
  rect: UnitRect;
  status?: SpaceStatusInfo;
  selected: boolean;
  /** Rendered device pixels per viewBox unit — every size below is set in pixels through it. */
  pxPerUnit: number;
  onClick?: (spaceId: string) => void;
}

function centerOf(rect: UnitRect) {
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 };
}

/**
 * Rough rendered width of a line of text. SVG has no text measurement
 * without a layout pass, and an average glyph width is close enough to size
 * a card around a label or decide it will not fit.
 */
function textWidthPx(text: string, fontPx: number, weight: number): number {
  return text.length * fontPx * (weight >= 600 ? 0.58 : 0.54);
}

/** The text, shortened with an ellipsis to fit `maxPx`, or null if too little would be left. */
function fitText(text: string, fontPx: number, weight: number, maxPx: number): string | null {
  if (textWidthPx(text, fontPx, weight) <= maxPx) return text;
  const chars = Math.floor(maxPx / (fontPx * (weight >= 600 ? 0.58 : 0.54))) - 1;
  if (chars < 4) return null;
  return text.slice(0, chars).trimEnd() + "…";
}

/**
 * Room for screen-aligned text inside a rect drawn at `rotation`: the rect
 * itself, swapped at a quarter turn, and its short side at any other angle.
 */
function textRoom(rect: UnitRect, rotation: number): { w: number; h: number } {
  const r = ((rotation % 180) + 180) % 180;
  if (r < 1 || r > 179) return { w: rect.w, h: rect.h };
  if (Math.abs(r - 90) < 1) return { w: rect.h, h: rect.w };
  const side = Math.min(rect.w, rect.h);
  return { w: side, h: side };
}

/** The floor a space shows: its own material, or the live or "soon" tint. */
function surfaceFor(base: Surface, status?: SpaceStatusInfo): Surface {
  if (!status) return base;
  return status.status === "live" ? SURFACES.live : SURFACES.soon;
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

/** A solid ink outline just outside the selected space. */
function SelectionRing({ rect, r, pxPerUnit }: { rect: UnitRect; r: number; pxPerUnit: number }) {
  const gap = 3 / pxPerUnit;
  return (
    <rect
      x={rect.x - gap}
      y={rect.y - gap}
      width={rect.w + gap * 2}
      height={rect.h + gap * 2}
      rx={r + gap}
      fill="none"
      stroke={MAP_COLORS.ink}
      strokeWidth={2 / pxPerUnit}
      pointerEvents="none"
    />
  );
}

/**
 * The pill that carries a transition alert ("Ends in 6 min", "→ Aquafit
 * 7:30 PM"). Sized from the map's rendered width, so it stays readable on a
 * big screen and does not swamp a phone. `anchor` "middle" centres it on
 * (x, y); "end" right-aligns it there (pool lanes, where it sits at the
 * lane's far end). When the full text would not fit `maxWidth`, the alert's
 * short form is drawn instead.
 */
export function AlertTag({
  x,
  y,
  alert,
  maxWidth,
  pxPerUnit,
  anchor = "middle",
}: {
  x: number;
  y: number;
  alert: SpaceAlert;
  maxWidth: number;
  pxPerUnit: number;
  anchor?: "middle" | "end";
}) {
  const mapPx = pxPerUnit * 1000; // VIEW_W
  const fs = clamp(11, mapPx / 80, 16) / pxPerUnit;
  const h = fs * 1.8;
  const widthOf = (t: string) => t.length * fs * 0.58 + fs * 1.4;
  const text = widthOf(alert.tag) <= maxWidth ? alert.tag : alert.shortTag;
  const w = widthOf(text);
  const left = anchor === "end" ? x - w : x - w / 2;
  const top = Math.max(0, y - h / 2);
  return (
    <g pointerEvents="none">
      <rect x={left} y={top} width={w} height={h} rx={h / 2} fill={MAP_COLORS.alert} />
      <text
        x={left + w / 2}
        y={top + h / 2}
        fontSize={fs}
        fontWeight={600}
        fill={MAP_COLORS.alertText}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </g>
  );
}

interface CardLine {
  text: string;
  /** In rendered pixels. */
  size: number;
  weight: number;
  color: string;
  /** False for a time: better to drop the line than show "ends 10:…". */
  truncate?: boolean;
}

/**
 * The white label card from the landing page, floating over whatever is on:
 * session name in ink, then its time in the space's tint. Lines drop from
 * the top when the space is too small (the space name first, then the
 * time); if even the session name will not fit, nothing is drawn and the
 * tint and the side panel carry it.
 */
function LabelCard({
  cx,
  cy,
  room,
  lines,
  titleIndex,
  pxPerUnit,
  rotation,
}: {
  cx: number;
  cy: number;
  room: { w: number; h: number };
  lines: CardLine[];
  /** Which line is the one that must survive. */
  titleIndex: number;
  pxPerUnit: number;
  /** Rotation of the frame this card sits in, undone so the card reads level. */
  rotation: number;
}) {
  const roomW = room.w * pxPerUnit - 10;
  const roomH = room.h * pxPerUnit - 8;

  const candidates: CardLine[][] = [lines];
  if (titleIndex > 0) candidates.push(lines.slice(titleIndex));
  candidates.push([lines[titleIndex]]);

  for (const candidate of candidates) {
    const single = candidate.length === 1;
    const padX = single ? 9 : 11;
    const padY = single ? 4 : 7;
    const maxTextPx = roomW - padX * 2;
    const fitted = candidate.map((l) => ({
      ...l,
      text:
        l.truncate === false
          ? textWidthPx(l.text, l.size, l.weight) <= maxTextPx
            ? l.text
            : null
          : fitText(l.text, l.size, l.weight, maxTextPx),
    }));
    if (fitted.some((l) => l.text === null)) continue;
    const heightPx = fitted.reduce((sum, l) => sum + l.size * 1.3, 0) + padY * 2;
    if (heightPx > roomH) continue;
    const widthPx = Math.max(...fitted.map((l) => textWidthPx(l.text!, l.size, l.weight))) + padX * 2;

    const u = (v: number) => v / pxPerUnit;
    const w = u(widthPx);
    const h = u(heightPx);
    const top = cy - h / 2 + u(padY);
    // Each line's centre: the top, plus the lines above it, plus half its own height.
    const centres = fitted.map((l, i) =>
      top + fitted.slice(0, i).reduce((sum, p) => sum + u(p.size * 1.3), 0) + u(l.size * 1.3) / 2
    );
    return (
      <g transform={rotation ? `rotate(${-rotation} ${cx} ${cy})` : undefined} pointerEvents="none">
        <rect
          x={cx - w / 2}
          y={cy - h / 2}
          width={w}
          height={h}
          rx={Math.min(u(10), h / 2)}
          fill={MAP_COLORS.card}
          stroke={MAP_COLORS.cardEdge}
          strokeWidth={u(1)}
        />
        {fitted.map((l, i) => {
          return (
            <text
              key={i}
              x={cx}
              y={centres[i]}
              fontSize={u(l.size)}
              fontWeight={l.weight}
              fill={l.color}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {l.text}
            </text>
          );
        })}
      </g>
    );
  }
  return null;
}

/**
 * What a standalone space says: its name alone when nothing is on, or a
 * card (space, session, time) when something is — plus an alert pill
 * straddling its top edge.
 */
function SpaceLabel({
  rect,
  rotation,
  name,
  status,
  surface,
  pxPerUnit,
}: {
  rect: UnitRect;
  rotation: number;
  name: string;
  status?: SpaceStatusInfo;
  surface: Surface;
  pxPerUnit: number;
}) {
  const { cx, cy } = centerOf(rect);
  const room = textRoom(rect, rotation);
  const u = (v: number) => v / pxPerUnit;

  // Top of the rotated shape's bounding box, in the counter-rotated frame.
  const theta = (rotation * Math.PI) / 180;
  const halfBoundH = (Math.abs(rect.w * Math.sin(theta)) + Math.abs(rect.h * Math.cos(theta))) / 2;
  const alertTag = status?.alert ? (
    <g transform={rotation ? `rotate(${-rotation} ${cx} ${cy})` : undefined}>
      <AlertTag
        x={cx}
        y={cy - halfBoundH}
        alert={status.alert}
        maxWidth={Math.max(rect.w, rect.h) * 1.2}
        pxPerUnit={pxPerUnit}
      />
    </g>
  ) : null;

  if (status) {
    return (
      <>
        <LabelCard
          cx={cx}
          cy={cy}
          room={room}
          rotation={rotation}
          pxPerUnit={pxPerUnit}
          titleIndex={name.trim().toLowerCase() === status.title.trim().toLowerCase() ? 0 : 1}
          lines={[
            // The space's own name, unless the session is simply called that.
            ...(name.trim().toLowerCase() === status.title.trim().toLowerCase()
              ? []
              : [{ text: name, size: 11, weight: 500, color: MAP_COLORS.inkSoft }]),
            { text: status.title, size: 13, weight: 600, color: MAP_COLORS.ink },
            { text: status.timeLabel, size: 12, weight: 500, color: surface.text, truncate: false },
          ]}
        />
        {alertTag}
      </>
    );
  }

  const fontPx = clamp(12, room.h * pxPerUnit * 0.2, 15);
  if (room.h * pxPerUnit < fontPx + 6) return null;
  const text = fitText(name, fontPx, 600, room.w * pxPerUnit - 12);
  if (!text) return null;
  return (
    <g transform={rotation ? `rotate(${-rotation} ${cx} ${cy})` : undefined} pointerEvents="none">
      <text
        x={cx}
        y={cy}
        fontSize={u(fontPx)}
        fontWeight={600}
        fill={surface.text}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </g>
  );
}

/**
 * Everything a standalone space shares: the rotation, the flat floor with
 * its edge (dashed while "starting soon", burnt orange for an alert), the
 * markings drawn by the caller, the selection ring and the label.
 */
function StandaloneFrame({
  shape,
  rect,
  r,
  base,
  status,
  selected,
  pxPerUnit,
  onClick,
  markings,
}: StandaloneShapeProps & {
  r: number;
  base: Surface;
  markings?: (surface: Surface) => ReactNode;
}) {
  const { cx, cy } = centerOf(rect);
  const surface = surfaceFor(base, status);
  const u = (v: number) => v / pxPerUnit;
  const edgeWidth = status?.alert ? 2.5 : status ? 2 : 1.5;
  const soonDash = status?.status === "soon" && !status.alert ? `${u(5)} ${u(4)}` : undefined;

  return (
    <g transform={shape.rotation ? `rotate(${shape.rotation} ${cx} ${cy})` : undefined}>
      <g {...interactionProps(shape, onClick)}>
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          rx={r}
          fill={surface.fill}
          stroke={status?.alert ? MAP_COLORS.alert : surface.edge}
          strokeWidth={u(edgeWidth)}
          strokeDasharray={soonDash}
        />
        {markings?.(surface)}
        <SpaceLabel
          rect={rect}
          rotation={shape.rotation}
          name={shape.displayName}
          status={status}
          surface={surface}
          pxPerUnit={pxPerUnit}
        />
        {selected && <SelectionRing rect={rect} r={r} pxPerUnit={pxPerUnit} />}
      </g>
    </g>
  );
}

/** Corner radius in units: `px` on screen, but never more than `share` of the short side. */
function radius(rect: UnitRect, px: number, share: number, pxPerUnit: number): number {
  return Math.min(px / pxPerUnit, Math.min(rect.w, rect.h) * share);
}

// ---------------------------------------------------------------------------
// Multi-lane pool
// ---------------------------------------------------------------------------

export interface PoolLane {
  shape: RenderShape;
  status?: SpaceStatusInfo;
}

/** Lanes next to each other showing the same thing, drawn under one card. */
function laneRuns(lanes: PoolLane[]): { from: number; to: number; status?: SpaceStatusInfo }[] {
  const runs: { from: number; to: number; status?: SpaceStatusInfo }[] = [];
  const same = (a?: SpaceStatusInfo, b?: SpaceStatusInfo) =>
    (!a && !b) ||
    (!!a && !!b && a.status === b.status && a.title === b.title && a.timeLabel === b.timeLabel);
  lanes.forEach((lane, i) => {
    const last = runs[runs.length - 1];
    if (last && same(last.status, lane.status)) last.to = i + 1;
    else runs.push({ from: i, to: i + 1, status: lane.status });
  });
  return runs;
}

/**
 * A multi-lane pool, drawn like the landing page's pool from above: pale
 * water, white dividers (dashed inside a run, solid where what's on
 * changes), the lane names along one side and one white card per run of
 * lanes showing the same session. Lanes divide the pool top-to-bottom in
 * the group's local (unrotated) frame, mirroring laneRectsWithinGroup, and
 * the whole group rotates as one.
 */
export function PoolShape({
  rect,
  rotation,
  lanes,
  selectedSpaceId,
  pxPerUnit,
  onLaneClick,
}: {
  rect: UnitRect;
  rotation: number;
  lanes: PoolLane[];
  selectedSpaceId?: string | null;
  pxPerUnit: number;
  onLaneClick?: (spaceId: string) => void;
}) {
  const clipId = `fm-pool-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { cx, cy } = centerOf(rect);
  const u = (v: number) => v / pxPerUnit;
  const r = radius(rect, 12, 0.12, pxPerUnit);
  const water = SURFACES.water;
  const stripeH = rect.h / lanes.length;
  const stripePxH = stripeH * pxPerUnit;
  const laneFontPx = clamp(10, stripePxH * 0.42, 13);
  const runs = laneRuns(lanes);
  const laneLabels = lanes.map((lane) =>
    stripePxH >= 14 ? fitText(lane.shape.displayName, laneFontPx, 600, rect.w * pxPerUnit * 0.3) : null
  );
  // Cards sit to the right of the lane names, so they never cover them.
  const labelColumn = u(
    Math.max(0, ...laneLabels.map((l) => (l ? textWidthPx(l, laneFontPx, 600) + 18 : 0)))
  );
  const runOf = (i: number) => runs.findIndex((run) => i >= run.from && i < run.to);

  return (
    <g transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}>
      <clipPath id={clipId}>
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={r} />
      </clipPath>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={r} fill={water.fill} />

      <g clipPath={`url(#${clipId})`}>
        {lanes.map((lane, i) => {
          const stripe: UnitRect = { x: rect.x, y: rect.y + i * stripeH, w: rect.w, h: stripeH };
          const surface = surfaceFor(water, lane.status);
          const stripeCy = stripe.y + stripe.h / 2;
          const labelX = stripe.x + u(10);
          const label = laneLabels[i];
          const selected = lane.shape.spaceId === selectedSpaceId;
          return (
            <g key={lane.shape.key} {...interactionProps(lane.shape, onLaneClick)}>
              {/* The whole stripe is the hit target; transparent when nothing is on. */}
              <rect
                x={stripe.x}
                y={stripe.y}
                width={stripe.w}
                height={stripe.h}
                fill={lane.status ? surface.fill : "transparent"}
              />
              {i > 0 && (
                <line
                  x1={stripe.x}
                  y1={stripe.y}
                  x2={stripe.x + stripe.w}
                  y2={stripe.y}
                  stroke="#ffffff"
                  strokeWidth={u(2)}
                  strokeDasharray={runOf(i) === runOf(i - 1) ? `${u(5)} ${u(4)}` : undefined}
                  pointerEvents="none"
                />
              )}
              {label && (
                <g
                  transform={rotation ? `rotate(${-rotation} ${labelX} ${stripeCy})` : undefined}
                  pointerEvents="none"
                >
                  <text
                    x={labelX}
                    y={stripeCy}
                    fontSize={u(laneFontPx)}
                    fontWeight={600}
                    fill={surface.text}
                    dominantBaseline="central"
                  >
                    {label}
                  </text>
                </g>
              )}
              {selected && (
                <rect
                  x={stripe.x + u(1.5)}
                  y={stripe.y + u(1.5)}
                  width={stripe.w - u(3)}
                  height={stripe.h - u(3)}
                  rx={u(4)}
                  fill="none"
                  stroke={MAP_COLORS.ink}
                  strokeWidth={u(2)}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* One outline and one card per run of lanes with something on. */}
        {runs.map((run) => {
          if (!run.status) return null;
          const surface = surfaceFor(water, run.status);
          const runRect: UnitRect = {
            x: rect.x,
            y: rect.y + run.from * stripeH,
            w: rect.w,
            h: (run.to - run.from) * stripeH,
          };
          const soon = run.status.status === "soon";
          const alert = run.status.alert;
          const inset = u(1);
          const runCenter = centerOf(runRect);
          const tagX = runRect.x + runRect.w - u(8);
          // The free part of the run: after the lane names, before any alert.
          const cardArea: UnitRect = {
            ...runRect,
            x: runRect.x + labelColumn,
            w: runRect.w - labelColumn - (alert ? runRect.w * 0.3 : u(8)),
          };
          const cardCenter = centerOf(cardArea);
          return (
            <g key={`run-${run.from}`} pointerEvents="none">
              <rect
                x={runRect.x + inset}
                y={runRect.y + inset}
                width={runRect.w - inset * 2}
                height={runRect.h - inset * 2}
                rx={u(4)}
                fill="none"
                stroke={alert ? MAP_COLORS.alert : surface.edge}
                strokeWidth={u(alert ? 2.5 : soon ? 1.5 : 2)}
                strokeDasharray={soon && !alert ? `${u(5)} ${u(4)}` : undefined}
              />
              {/* One alert per run of lanes, at its far end. */}
              {alert && (
                <g transform={rotation ? `rotate(${-rotation} ${tagX} ${runCenter.cy})` : undefined}>
                  <AlertTag
                    x={tagX}
                    y={runCenter.cy}
                    alert={alert}
                    maxWidth={runRect.w * 0.3}
                    pxPerUnit={pxPerUnit}
                    anchor="end"
                  />
                </g>
              )}
              <LabelCard
                cx={cardCenter.cx}
                cy={cardCenter.cy}
                room={textRoom(cardArea, rotation)}
                rotation={rotation}
                pxPerUnit={pxPerUnit}
                titleIndex={0}
                lines={[
                  { text: run.status.title, size: 13, weight: 600, color: MAP_COLORS.ink },
                  { text: run.status.timeLabel, size: 12, weight: 500, color: surface.text, truncate: false },
                ]}
              />
            </g>
          );
        })}
      </g>

      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        rx={r}
        fill="none"
        stroke={water.edge}
        strokeWidth={u(2)}
        pointerEvents="none"
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Leisure pool
// ---------------------------------------------------------------------------

/** Free-form water: a heavily rounded pale pool. */
export function LeisurePoolShape(props: StandaloneShapeProps) {
  const r = Math.min(props.rect.w, props.rect.h) * 0.3;
  return <StandaloneFrame {...props} r={r} base={SURFACES.water} />;
}

// ---------------------------------------------------------------------------
// Courts
// ---------------------------------------------------------------------------

/** Court markings in the shape's local frame — simplified, recognition-level, not regulation diagrams. */
function CourtMarkings({
  rect,
  family,
  strokeW,
  color,
}: {
  rect: UnitRect;
  family: ShapeFamily;
  strokeW: number;
  color: string;
}) {
  const { x, y, w, h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const common = {
    stroke: color,
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

/** The inner boundary line most sports floors have, inset from the edge. */
function BoundaryLine({ rect, r, strokeW, color }: { rect: UnitRect; r: number; strokeW: number; color: string }) {
  const inset = strokeW * 3;
  return (
    <rect
      x={rect.x + inset}
      y={rect.y + inset}
      width={rect.w - inset * 2}
      height={rect.h - inset * 2}
      rx={Math.max(0, r - inset)}
      fill="none"
      stroke={color}
      strokeWidth={strokeW}
      pointerEvents="none"
    />
  );
}

/** A court: a pale floor in its material's tint, with its lines. */
export function CourtShape(props: StandaloneShapeProps & { family: ShapeFamily }) {
  const { rect, pxPerUnit, family } = props;
  const r = radius(rect, 10, 0.06, pxPerUnit);
  const material = courtMaterial(family);
  const base = material === "wood" ? SURFACES.wood : material === "acrylicGreen" ? SURFACES.acrylicGreen : SURFACES.acrylicBlue;
  const showMarkings = rect.w * pxPerUnit >= 110;
  const strokeW = clamp(1.2, 1.5 / pxPerUnit, 3);
  return (
    <StandaloneFrame
      {...props}
      r={r}
      base={base}
      markings={(surface) => (
        <>
          <BoundaryLine rect={rect} r={r} strokeW={strokeW} color={surface.marking} />
          {showMarkings && <CourtMarkings rect={rect} family={family} strokeW={strokeW} color={surface.marking} />}
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Ice rink
// ---------------------------------------------------------------------------

/** An ice rink: pale ice, hockey-rounded corners, soft red and blue lines. */
export function RinkShape(props: StandaloneShapeProps) {
  const { rect, pxPerUnit, status } = props;
  const { cx, cy } = centerOf(rect);
  const r = Math.min(rect.w, rect.h) * 0.22;
  const showMarkings = rect.w * pxPerUnit >= 110;
  const strokeW = clamp(1.2, 1.5 / pxPerUnit, 3);
  return (
    <StandaloneFrame
      {...props}
      r={r}
      base={SURFACES.ice}
      markings={(surface) => {
        if (!showMarkings) return null;
        const red = status ? surface.marking : "#f1b9b9";
        const blue = status ? surface.marking : "#bdd0ea";
        return (
          <g pointerEvents="none">
            <line x1={cx} y1={rect.y} x2={cx} y2={rect.y + rect.h} stroke={red} strokeWidth={strokeW * 1.4} />
            <line x1={rect.x + rect.w * 0.31} y1={rect.y} x2={rect.x + rect.w * 0.31} y2={rect.y + rect.h} stroke={blue} strokeWidth={strokeW * 1.2} />
            <line x1={rect.x + rect.w * 0.69} y1={rect.y} x2={rect.x + rect.w * 0.69} y2={rect.y + rect.h} stroke={blue} strokeWidth={strokeW * 1.2} />
            <circle cx={cx} cy={cy} r={Math.min(rect.h * 0.18, rect.w * 0.08)} fill="none" stroke={red} strokeWidth={strokeW} />
          </g>
        );
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Gym floor
// ---------------------------------------------------------------------------

/** Multi-use hardwood: a boundary line, deliberately no sport markings. */
export function GymFloorShape(props: StandaloneShapeProps) {
  const { rect, pxPerUnit } = props;
  const r = radius(rect, 10, 0.06, pxPerUnit);
  const strokeW = clamp(1.2, 1.5 / pxPerUnit, 3);
  return (
    <StandaloneFrame
      {...props}
      r={r}
      base={SURFACES.wood}
      markings={(surface) => <BoundaryLine rect={rect} r={r} strokeW={strokeW} color={surface.marking} />}
    />
  );
}

// ---------------------------------------------------------------------------
// Climbing wall
// ---------------------------------------------------------------------------

/** A climbing wall: a pale grey panel scattered with muted holds (deterministic layout). */
export function ClimbingWallShape(props: StandaloneShapeProps) {
  const { rect, pxPerUnit, status } = props;
  const r = radius(rect, 8, 0.08, pxPerUnit);
  const showHolds = !status && rect.w * pxPerUnit >= 80;

  // A tiny LCG so the wall looks the same on every render without storing anything.
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
        y: rect.y + rect.h * (0.12 + next() * 0.76),
        color: MAP_COLORS.holds[Math.floor(next() * MAP_COLORS.holds.length)],
      });
    }
  }
  const holdR = clamp(1.5, Math.min(rect.w, rect.h) * 0.035, 4);

  return (
    <StandaloneFrame
      {...props}
      r={r}
      base={SURFACES.stone}
      markings={() =>
        holds.map((hold, i) => <circle key={i} cx={hold.x} cy={hold.y} r={holdR} fill={hold.color} pointerEvents="none" />)
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Generic room
// ---------------------------------------------------------------------------

/** A studio or room: white, with a hairline edge, like the landing page's cards. */
export function RoomShape(props: StandaloneShapeProps) {
  const r = radius(props.rect, 10, 0.08, props.pxPerUnit);
  return <StandaloneFrame {...props} r={r} base={SURFACES.room} />;
}

// ---------------------------------------------------------------------------
// Context scenery
// ---------------------------------------------------------------------------

/** Non-interactive scenery: quiet labelled zones and the entrance marker. */
export function ContextElement({
  element,
  rect,
  pxPerUnit,
}: {
  element: RenderContextElement;
  rect: UnitRect;
  pxPerUnit: number;
}) {
  const { cx, cy } = centerOf(rect);
  const u = (v: number) => v / pxPerUnit;

  if (element.kind === "entrance") {
    const barH = Math.min(rect.h, u(5));
    const barY = rect.y + rect.h - barH;
    const triW = Math.min(u(12), rect.w * 0.3);
    const label = element.label ?? "Entrance";
    const fontPx = 12;
    const text = fitText(label, fontPx, 600, Math.max(rect.w * pxPerUnit, 90));
    return (
      <g transform={element.rotation ? `rotate(${element.rotation} ${cx} ${cy})` : undefined} pointerEvents="none">
        <rect x={rect.x} y={barY} width={rect.w} height={barH} rx={barH / 2} fill={MAP_COLORS.entrance} />
        <path d={`M ${cx} ${barY - triW * 0.2} l ${-triW / 2} ${-triW * 0.75} h ${triW} z`} fill={MAP_COLORS.entrance} />
        {text && (
          <text
            x={cx}
            y={barY - triW * 1.25}
            fontSize={u(fontPx)}
            fontWeight={600}
            fill={MAP_COLORS.entrance}
            textAnchor="middle"
          >
            {text}
          </text>
        )}
      </g>
    );
  }

  const r = radius(rect, 10, 0.1, pxPerUnit);
  const room = textRoom(rect, element.rotation);
  const text = element.label ? fitText(element.label, 12, 500, room.w * pxPerUnit - 12) : null;
  return (
    <g transform={element.rotation ? `rotate(${element.rotation} ${cx} ${cy})` : undefined} pointerEvents="none">
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={r} fill={MAP_COLORS.zoneFill} />
      {text && room.h * pxPerUnit >= 20 && (
        <g transform={element.rotation ? `rotate(${-element.rotation} ${cx} ${cy})` : undefined}>
          <text
            x={cx}
            y={cy}
            fontSize={u(12)}
            fontWeight={500}
            fill={MAP_COLORS.zoneText}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {text}
          </text>
        </g>
      )}
    </g>
  );
}
