/**
 * Input types for the shared facility-map SVG renderer. Both the public
 * floorplan view and the admin map builder feed this same shape, so "what
 * admins build is what visitors see" holds by construction — there is one
 * renderer, not a viewer copy and an editor copy.
 */

/** One placeable shape, in the same normalized 0..1 geometry as space_hotspots. */
export interface RenderShape {
  /** Stable React key — DB id for saved rows, a generated key in the editor. */
  key: string;
  spaceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise, pivot = shape center (CSS rotate() convention). */
  rotation: number;
  /** Preset the shape was placed from — selects its illustrated rendering. */
  presetKey: string;
  /** Resolved display name (label override ?? space name). */
  displayName: string;
  /** Shared by every lane of one multi-lane preset; null for standalone shapes. */
  groupId: string | null;
  /** Stable relative order within a group — see geometry.ts; never a literal slot. */
  laneIndex: number | null;
}

/** Non-interactive scenery: labeled zones and the entrance marker. */
export interface RenderContextElement {
  key: string;
  kind: "zone" | "entrance";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string | null;
}

/**
 * What's happening in a space at the viewed time. Absence from the status
 * map means the space is free — there is deliberately no "free" variant so
 * a lookup miss and "nothing scheduled" are the same code path.
 */
export interface SpaceStatusInfo {
  status: "live" | "soon";
  /** Session display name, e.g. "Lap Swim". */
  title: string;
  /** Ready-to-render time note, e.g. "ends 7:45 PM" or "starts 7:30 PM". */
  timeLabel: string;
}

export type StatusBySpaceId = ReadonlyMap<string, SpaceStatusInfo>;
