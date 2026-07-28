/**
 * The facility map's visual language ("soft depth" direction): every
 * material and status color the renderer uses, plus the preset-key →
 * shape-family mapping that decides which illustration a hotspot gets.
 *
 * The map is deliberately a light "paper map" in both app themes — like an
 * embedded street map, it reads as an illustration of a physical place, not
 * a themed UI surface. Status colors are the exception: live spaces use the
 * org's accent (via --org-accent, matching every other schedule view) and
 * "starting soon" uses a fixed amber that stays legible on all materials.
 */

export const MAP_COLORS = {
  floorTop: "#F7F4EF",
  floorBottom: "#EDE8E0",
  shellFill: "rgba(255,255,255,0.55)",
  shellStroke: "#C9C2B6",

  deck: "#DCE9EF",
  waterTop: "#6FBEDC",
  waterBottom: "#4A9FC2",
  waterText: "#FFFFFF",
  waterTextDim: "#E4F2F8",
  rope: "rgba(255,255,255,0.85)",

  woodLight: "#E9B27C",
  woodDark: "#D6945A",
  acrylicGreenLight: "#79AC90",
  acrylicGreenDark: "#5E9377",
  acrylicBlueLight: "#6E9DBC",
  acrylicBlueDark: "#5586A6",
  marking: "rgba(255,255,255,0.92)",

  roomFill: "#F3EFE8",
  roomStroke: "#DDD5C8",
  ink: "#3B4149",
  inkSoft: "#6E7682",

  zoneFill: "#E9E4DB",
  zoneText: "#948C7E",
  entrance: "#3B4149",

  ice: "#EDF5F9",
  iceLine: "#C74A4A",
  iceBlue: "#4A7BC7",
  iceText: "#4A6B85",
  stoneLight: "#A99E90",
  stoneDark: "#8D8274",

  accent: "var(--org-accent, #2563eb)",
  soonFill: "#F5A623",
  soonStroke: "#E8960C",
  soonText: "#8A5B04",

  card: "#FFFFFF",
} as const;

/** Soft lift under every placed shape. */
export const SHAPE_SHADOW = "drop-shadow(0 2px 3px rgba(58,52,43,0.28))";
/** Accent halo behind live spaces. */
export const LIVE_GLOW =
  "drop-shadow(0 0 9px color-mix(in srgb, var(--org-accent, #2563eb) 55%, transparent))";

export type ShapeFamily =
  | "pool"
  | "leisure-pool"
  | "court-basketball"
  | "court-tennis"
  | "court-volleyball"
  | "court-badminton"
  | "court-pickleball"
  | "rink"
  | "gym-floor"
  | "climbing-wall"
  | "room";

/**
 * Preset key → illustration family. Prefix-matched so a preset added later
 * (e.g. "pool-10lane-50m") gets the right material without touching this
 * file, and an unrecognized key degrades to the generic room rather than
 * failing — preset keys are app-level data with no DB constraint (see 019).
 */
export function shapeFamily(presetKey: string): ShapeFamily {
  if (presetKey === "pool-leisure") return "leisure-pool";
  if (presetKey.startsWith("pool")) return "pool";
  switch (presetKey) {
    case "court-basketball":
      return "court-basketball";
    case "court-tennis":
      return "court-tennis";
    case "court-volleyball":
      return "court-volleyball";
    case "court-badminton":
      return "court-badminton";
    case "court-pickleball":
      return "court-pickleball";
  }
  if (presetKey.startsWith("court-")) return "court-basketball";
  if (presetKey.startsWith("rink")) return "rink";
  if (presetKey.startsWith("gym")) return "gym-floor";
  if (presetKey.startsWith("climb")) return "climbing-wall";
  return "room";
}

/** Court floor material per family — wood for hardwood sports, acrylic for racquet sports. */
export function courtMaterial(family: ShapeFamily): "wood" | "acrylicGreen" | "acrylicBlue" {
  switch (family) {
    case "court-tennis":
    case "court-badminton":
      return "acrylicGreen";
    case "court-pickleball":
      return "acrylicBlue";
    default:
      return "wood";
  }
}

export function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
