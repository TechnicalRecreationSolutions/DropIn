import type {
  RenderShape,
  SpaceAlert,
  SpaceStatusInfo,
  StatusBySpaceId,
} from "@/components/facility-maps/renderer/types";

/**
 * Sample buildings for the marketing page, in the renderer's own input model.
 *
 * The page draws these through `FacilityMapSvg` — the same engine the public
 * floorplan and the map builder use — so what a prospect sees is what the
 * product draws, not an illustration of it. Only the *data* is invented, and
 * every surface that shows it is captioned as a sample.
 *
 * Statuses are pre-built strings rather than sessions run through
 * `computeFloorplanStatus`. That function reads the clock and formats Dates,
 * and a marketing page rendered on the server in UTC and hydrated in the
 * visitor's zone would disagree with itself about both.
 *
 * Two rules the samples keep, because the product keeps them:
 *  - Sections of a floor are fixed spaces. Nothing here re-lines a court or
 *    moves a bulkhead; alternate layouts are not built.
 *  - A space with nothing scheduled is simply absent from `entries`. The
 *    samples never call it open, free or available — empty is not usable.
 */

export interface SampleEntry {
  /** Spaces this session holds at the moment shown. */
  spaceIds: string[];
  /** How the legend names those spaces, e.g. "Lanes 1–3". */
  where: string;
  title: string;
  status: SpaceStatusInfo["status"];
  timeLabel: string;
  alert?: SpaceAlert;
}

export interface SampleMoment {
  /** The time chip, and the legend's heading. */
  label: string;
  entries: SampleEntry[];
}

export interface SampleFacility {
  name: string;
  /** Real-world metres, as `facility_maps.canvas_width/height`. */
  canvasWidth: number;
  canvasHeight: number;
  shapes: RenderShape[];
  moments: SampleMoment[];
}

export function statusMapFor(moment: SampleMoment): StatusBySpaceId {
  const map = new Map<string, SpaceStatusInfo>();
  for (const entry of moment.entries) {
    for (const id of entry.spaceIds) {
      map.set(id, {
        status: entry.status,
        title: entry.title,
        timeLabel: entry.timeLabel,
        alert: entry.alert,
      });
    }
  }
  return map;
}

const lanes = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `lane-${from + i}`);

/** Every lane of a pool group carries the identical outer rect (migration 018). */
const POOL_RECT = { x: 0.025, y: 0.1, width: 0.55, height: 0.8 };

const poolLanes: RenderShape[] = Array.from({ length: 8 }, (_, i) => ({
  key: `lane-${i + 1}`,
  spaceId: `lane-${i + 1}`,
  ...POOL_RECT,
  rotation: 0,
  presetKey: "pool-8lane-25m",
  displayName: `Lane ${i + 1}`,
  groupId: "main-pool",
  laneIndex: i,
}));

function standalone(
  id: string,
  presetKey: string,
  displayName: string,
  rect: { x: number; y: number; width: number; height: number }
): RenderShape {
  return { key: id, spaceId: id, ...rect, rotation: 0, presetKey, displayName, groupId: null, laneIndex: null };
}

export const SAMPLE_POOL: SampleFacility = {
  name: "Sample aquatic centre",
  canvasWidth: 42,
  canvasHeight: 24,
  shapes: [
    ...poolLanes,
    standalone("leisure", "pool-leisure", "Leisure pool", { x: 0.6, y: 0.1, width: 0.375, height: 0.46 }),
    standalone("hot-tub", "pool-leisure", "Hot tub", { x: 0.69, y: 0.64, width: 0.195, height: 0.26 }),
  ],
  moments: [
    {
      label: "7:10 AM",
      entries: [
        { spaceIds: lanes(1, 3), where: "Lanes 1–3", title: "Reserved", status: "live", timeLabel: "ends 8:00 AM" },
        { spaceIds: lanes(4, 8), where: "Lanes 4–8", title: "Lane swim", status: "live", timeLabel: "ends 8:00 AM" },
        { spaceIds: ["leisure"], where: "Leisure pool", title: "Aquafit", status: "live", timeLabel: "ends 7:45 AM" },
      ],
    },
    {
      label: "8:15 AM",
      entries: [
        { spaceIds: lanes(1, 4), where: "Lanes 1–4", title: "Lane swim", status: "live", timeLabel: "ends 9:00 AM" },
        { spaceIds: lanes(5, 8), where: "Lanes 5–8", title: "Swim lessons", status: "live", timeLabel: "ends 9:00 AM" },
        { spaceIds: ["leisure"], where: "Leisure pool", title: "Parent and tot swim", status: "live", timeLabel: "ends 9:30 AM" },
      ],
    },
    {
      label: "7:20 PM",
      entries: [
        { spaceIds: lanes(1, 2), where: "Lanes 1–2", title: "Lane swim", status: "live", timeLabel: "ends 9:00 PM" },
        { spaceIds: lanes(3, 8), where: "Lanes 3–8", title: "Reserved", status: "live", timeLabel: "ends 9:00 PM" },
        {
          spaceIds: ["leisure"],
          where: "Leisure pool",
          title: "Family swim",
          status: "live",
          timeLabel: "ends 7:30 PM",
          alert: { kind: "changeover", tag: "→ Aquafit 7:30 PM", shortTag: "→ 7:30 PM" },
        },
      ],
    },
  ],
};

/**
 * One hardwood floor in three fixed sections. `gym-floor` on purpose: it is the
 * preset with no sport markings, which is the honest picture of a floor that
 * hosts a different sport each hour.
 */
export const SAMPLE_COURTS: SampleFacility = {
  name: "Sample gymnasium",
  canvasWidth: 42,
  canvasHeight: 24,
  shapes: [
    standalone("court-1", "gym-floor", "Court 1", { x: 0.05, y: 0.14, width: 0.28, height: 0.72 }),
    standalone("court-2", "gym-floor", "Court 2", { x: 0.36, y: 0.14, width: 0.28, height: 0.72 }),
    standalone("court-3", "gym-floor", "Court 3", { x: 0.67, y: 0.14, width: 0.28, height: 0.72 }),
  ],
  moments: [
    {
      label: "7:10 AM",
      entries: [
        { spaceIds: ["court-1"], where: "Court 1", title: "Adult basketball", status: "live", timeLabel: "ends 8:00 AM" },
        { spaceIds: ["court-2", "court-3"], where: "Courts 2–3", title: "Pickleball", status: "soon", timeLabel: "starts 7:30 AM" },
      ],
    },
    {
      label: "8:15 AM",
      entries: [
        { spaceIds: ["court-1"], where: "Court 1", title: "Volleyball", status: "live", timeLabel: "ends 9:30 AM" },
        { spaceIds: ["court-2", "court-3"], where: "Courts 2–3", title: "Pickleball", status: "live", timeLabel: "ends 10:00 AM" },
      ],
    },
    {
      label: "7:20 PM",
      entries: [
        { spaceIds: ["court-1"], where: "Court 1", title: "Reserved", status: "live", timeLabel: "ends 9:00 PM" },
        // The tagged space is the middle one: a tag is centred on its shape and
        // is wider than a court on a phone, so at either edge it is clipped.
        {
          spaceIds: ["court-2"],
          where: "Court 2",
          title: "Volleyball",
          status: "live",
          timeLabel: "ends 7:30 PM",
          alert: { kind: "changeover", tag: "→ Basketball 7:30 PM", shortTag: "→ 7:30 PM" },
        },
        { spaceIds: ["court-3"], where: "Court 3", title: "Pickleball", status: "live", timeLabel: "ends 9:00 PM" },
      ],
    },
  ],
};
