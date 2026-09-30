/**
 * The facility map's visual language: the landing page's "pool from above"
 * picture, applied to every kind of space. Flat pale fills, a slightly
 * darker edge, white or tinted markings, no gradients, shadows or glows
 * (docs/DESIGN.md). What's on is a white label card floating over the
 * space, as on the landing page, not a coloured wash with text on it.
 *
 * The map stays light in both app themes, like an embedded street map: it
 * is a picture of a building, not a themed UI surface. Live spaces take the
 * centre's own colour (--org-primary, the same one every other schedule view
 * uses for "today" and "now"); "starting soon" is a fixed amber.
 */

/** One kind of floor: its fill, edge, label colour and line markings. */
export interface Surface {
  fill: string;
  edge: string;
  text: string;
  marking: string;
}

const ORG = "var(--org-primary, #0066cc)";

export const SURFACES = {
  water: { fill: "#e6f0fa", edge: "#cfe0f5", text: "#004a94", marking: "#ffffff" },
  wood: { fill: "#f7ecdf", edge: "#ead7bf", text: "#7a4a1c", marking: "#e2c9a6" },
  acrylicGreen: { fill: "#e6f2e9", edge: "#cbe3d2", text: "#14532d", marking: "#b5d8bf" },
  acrylicBlue: { fill: "#e2f2ef", edge: "#c4e3dc", text: "#0b5a54", marking: "#a9d6cc" },
  ice: { fill: "#f3f8fb", edge: "#d6e3ec", text: "#3f5a70", marking: "#c9d9e6" },
  turf: { fill: "#e4f1dc", edge: "#c9e0ba", text: "#2f5a1f", marking: "#b8d7a4" },
  stone: { fill: "#efeff1", edge: "#dcdce0", text: "#3f3f45", marking: "#dcdce0" },
  room: { fill: "#ffffff", edge: "#e4e4e7", text: "#111113", marking: "#e4e4e7" },
  live: {
    fill: `color-mix(in srgb, ${ORG} 16%, white)`,
    edge: ORG,
    text: "var(--org-text-on-tint, #004a94)",
    marking: `color-mix(in srgb, ${ORG} 28%, white)`,
  },
  soon: { fill: "#fdf1dc", edge: "#e9b25a", text: "#8a5b04", marking: "#f3d9a8" },
} as const satisfies Record<string, Surface>;

export const MAP_COLORS = {
  floor: "#f4f4f5",
  ink: "#111113",
  inkSoft: "#5d5d63",
  card: "#ffffff",
  cardEdge: "rgba(17,17,19,0.10)",

  zoneFill: "#e9e9ec",
  zoneText: "#6b6b72",
  entrance: "#111113",

  accent: ORG,
  soonFill: SURFACES.soon.fill,
  soonStroke: SURFACES.soon.edge,
  soonText: SURFACES.soon.text,
  /**
   * Transition alerts (ending / changeover / starting within minutes). A
   * burnt orange rather than the "soon" amber, so an alert still reads next
   * to an amber "soon" space.
   */
  alert: "#c2410c",
  alertText: "#ffffff",

  /** Muted climbing holds, so the wall reads as a wall without shouting. */
  holds: ["#f2c4bf", "#f5dca9", "#c6e2cd", "#c5d9ee", "#dccfee"],
} as const;

export type ShapeFamily =
  | "pool"
  | "leisure-pool"
  | "court-basketball"
  | "court-tennis"
  | "court-volleyball"
  | "court-badminton"
  | "court-pickleball"
  | "rink"
  | "field"
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
  if (presetKey.startsWith("field")) return "field";
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
