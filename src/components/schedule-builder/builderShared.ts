/**
 * Which builder layout is displayed. All three are fully editable — they
 * differ only in visual arrangement and how a new session is placed.
 */
export type BuilderView = "space" | "grid" | "list";

/** A session template as dragged from TemplatePalette, en route to being placed. */
export interface DroppedTemplate {
  id: string;
  name: string;
  color: string | null;
  defaultDurationMinutes: number;
  defaultSpaceIds: string[];
}

// Time-axis geometry and week/day helpers now live in src/lib/schedule/weekGeometry.ts
// (shared with the public WeeklyScheduleGrid/WeeklyScheduleMap, not builder-specific) —
// re-exported here so existing builder imports keep working unchanged.
export {
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
  GRID_START_HOUR,
  GRID_END_HOUR,
  getSessionPixelPosition,
  pixelOffsetToStartTime,
  getHourLabels,
  getGridHeightPx,
  DAYS,
  dayIndexFromDate,
  timeStringToMinutes,
  minutesToTimeString,
  type WeekDay as BuilderDay,
} from "@/lib/schedule/weekGeometry";
