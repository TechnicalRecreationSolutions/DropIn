/**
 * Rotation-aware geometry helpers for the shape canvas. All positions are
 * in the same unitless 2D space the caller works in (canvas-fraction or
 * real screen pixels — the math doesn't care, as long a single call uses
 * one consistently). Rotation is in degrees, clockwise, matching CSS
 * `transform: rotate()`.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Rotates a point by `deg` clockwise around the origin (matches CSS rotate()'s screen-space sense, y-down). */
export function rotatePoint(p: Point, deg: number): Point {
  const rad = toRadians(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  };
}

export function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Resize a rotated rectangle by dragging its bottom-right corner, keeping
 * the opposite (top-left, in local/unrotated space) corner visually fixed
 * in world space.
 *
 * 1. anchor = the fixed corner's world position, derived from the rect's
 *    center + rotation (world = center + R(theta) * localOffsetFromCenter).
 * 2. localPointer = R(-theta) * (pointerWorld - anchor) — the pointer's
 *    position relative to the anchor, expressed in the shape's own
 *    (unrotated) coordinate frame. Because the anchor is the local origin
 *    in that frame, localPointer.x/y ARE the new width/height directly.
 * 3. newCenter = anchor + R(theta) * (newWidth/2, newHeight/2) —
 *    reproject the center back into world space from the anchor.
 */
export function resizeFromOppositeCorner(
  rect: Rect,
  rotationDeg: number,
  pointerWorld: Point,
  minSize: number
): Rect {
  const c = center(rect);
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  // Anchor = top-left corner in local space, projected into world space.
  const anchorOffset = rotatePoint({ x: -halfW, y: -halfH }, rotationDeg);
  const anchor: Point = { x: c.x + anchorOffset.x, y: c.y + anchorOffset.y };

  // Pointer position relative to the anchor, un-rotated into local space.
  const delta: Point = { x: pointerWorld.x - anchor.x, y: pointerWorld.y - anchor.y };
  const localPointer = rotatePoint(delta, -rotationDeg);

  const newWidth = Math.max(minSize, localPointer.x);
  const newHeight = Math.max(minSize, localPointer.y);

  // Reproject the new center from the anchor, back into world space.
  const centerOffset = rotatePoint({ x: newWidth / 2, y: newHeight / 2 }, rotationDeg);
  const newCenter: Point = { x: anchor.x + centerOffset.x, y: anchor.y + centerOffset.y };

  return {
    x: newCenter.x - newWidth / 2,
    y: newCenter.y - newHeight / 2,
    width: newWidth,
    height: newHeight,
  };
}

/** Angle in degrees (0-359, clockwise from north) from `center` to `pointer` — for the rotation handle. */
export function angleFromCenter(centerPoint: Point, pointer: Point): number {
  // atan2(x, -y) puts 0deg at north (up) and increases clockwise, matching
  // the rotation grip's resting position above the shape.
  const rad = Math.atan2(pointer.x - centerPoint.x, -(pointer.y - centerPoint.y));
  const deg = (rad * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function clampRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Divides a group's shared outer rect into `laneCount` equal-height
 * horizontal stripes (each spanning the full width), stacked top to
 * bottom — matches how real pool lanes lay out side by side across the
 * pool's short axis. Returns rects in the SAME (local/unrotated)
 * coordinate space as `groupRect` — the caller applies the group's shared
 * rotation to the whole wrapper once via CSS transform, so these stripes
 * never need their own rotation math.
 *
 * `laneCount` should always be the group's CURRENT row count, not a count
 * captured at placement time — that's what makes deleting one lane cause
 * the rest to evenly re-expand on the next render, with no renumbering.
 */
export function laneRectsWithinGroup(groupRect: Rect, laneCount: number): Rect[] {
  const stripeHeight = groupRect.height / laneCount;
  return Array.from({ length: laneCount }, (_, i) => ({
    x: groupRect.x,
    y: groupRect.y + i * stripeHeight,
    width: groupRect.width,
    height: stripeHeight,
  }));
}
