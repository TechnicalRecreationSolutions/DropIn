/**
 * Preset shapes for the facility map builder — real-world dimensions in
 * meters, used only to seed a newly-placed shape's initial width/height.
 * Not persisted anywhere: once placed, a shape is just rect + rotation +
 * label on space_hotspots, free to be resized away from its preset's
 * aspect ratio. A fixed, small list like this doesn't need a DB table —
 * no per-org customization, no search, no admin UI to manage it.
 *
 * `laneCount` is how many independently-tracked sub-rectangles ("lanes")
 * a single placed preset represents — e.g. a "4-Lane 25m Pool" occupies
 * one outer rectangle divided into 4 live-status stripes, each linked to
 * its own Space. Non-lane presets (courts, generic rooms) use
 * `laneCount: 1`, i.e. "a group of one," so placement/rendering code has
 * a single path rather than branching preset-with-lanes vs. without.
 */
export interface ShapePreset {
  key: string;
  label: string;
  category: "pool" | "court" | "generic";
  widthM: number;
  heightM: number;
  laneCount: number;
}

export const SHAPE_PRESETS: ShapePreset[] = [
  { key: "pool-4lane-25m", label: "4-Lane 25m Pool", category: "pool", widthM: 25, heightM: 9, laneCount: 4 },
  { key: "pool-6lane-25m", label: "6-Lane 25m Pool", category: "pool", widthM: 25, heightM: 13, laneCount: 6 },
  { key: "pool-8lane-25m", label: "8-Lane 25m Pool", category: "pool", widthM: 25, heightM: 17, laneCount: 8 },
  { key: "pool-6lane-50m", label: "6-Lane 50m Pool", category: "pool", widthM: 50, heightM: 13, laneCount: 6 },
  { key: "pool-leisure", label: "Leisure Pool", category: "pool", widthM: 12, heightM: 10, laneCount: 1 },
  { key: "court-basketball", label: "Basketball Court", category: "court", widthM: 28, heightM: 15, laneCount: 1 },
  { key: "court-tennis", label: "Tennis Court", category: "court", widthM: 23.77, heightM: 10.97, laneCount: 1 },
  { key: "court-volleyball", label: "Volleyball Court", category: "court", widthM: 18, heightM: 9, laneCount: 1 },
  { key: "court-badminton", label: "Badminton Court", category: "court", widthM: 13.4, heightM: 6.1, laneCount: 1 },
  { key: "court-pickleball", label: "Pickleball Court", category: "court", widthM: 13.41, heightM: 6.1, laneCount: 1 },
  { key: "generic-small", label: "Small Room", category: "generic", widthM: 8, heightM: 6, laneCount: 1 },
  { key: "generic-large", label: "Large Room", category: "generic", widthM: 15, heightM: 12, laneCount: 1 },
];

export const SHAPE_PRESET_CATEGORIES: { value: ShapePreset["category"]; label: string }[] = [
  { value: "pool", label: "Pools" },
  { value: "court", label: "Courts" },
  { value: "generic", label: "Generic" },
];
