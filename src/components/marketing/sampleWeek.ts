/**
 * One sample week at the sample aquatic centre — the schedule behind the hero
 * widget and the printed-schedule sample.
 *
 * It is written down once, here, because the page shows the same Monday four
 * ways (lane view, list, the printout, the deck sheet) and they were caught
 * disagreeing when each sample kept its own copy. The two views that show a
 * week (grid, board) read the same sessions, so a change here moves all of
 * them together.
 *
 * Times are minutes from midnight, formatted by the helpers below. No Date is
 * involved on purpose: a Date formatted on the server in UTC and again in the
 * visitor's zone is a hydration mismatch.
 *
 * The lane rule is already applied. Lane swim is a drop-in that was entered
 * for lanes 1–8; what is recorded here is what the public is shown once the
 * club (6–8, lanes 1–3) and the lessons (8–9, lanes 5–8) have taken theirs —
 * which is why lane swim appears as two sessions in the morning.
 */

export type Tone = "lane" | "reserved" | "fitness" | "lessons" | "family" | "public";

export interface SampleSession {
  key: string;
  name: string;
  /** For columns too narrow for the name. */
  short: string;
  start: number;
  end: number;
  /** Inclusive lane range, or null for a session that is not in the lanes. */
  lanes: [number, number] | null;
  /** The space, for a session that is not in the lanes. */
  space: string | null;
  tone: Tone;
  /** A staff-defined tag, shown on screen only — tags are not printed. */
  tag?: string;
  /** Age group and level, which is what the printout's last column carries. */
  notes?: string;
}

const LEISURE = "Leisure pool";

function session(
  key: string,
  name: string,
  start: number,
  end: number,
  where: [number, number] | string,
  tone: Tone,
  extra: { short?: string; tag?: string; notes?: string } = {}
): SampleSession {
  const inLanes = typeof where !== "string";
  return {
    key,
    name,
    short: extra.short ?? name,
    start,
    end,
    lanes: inLanes ? where : null,
    space: inLanes ? null : where,
    tone,
    tag: extra.tag,
    notes: extra.notes,
  };
}

const at = (hour: number, minute = 0) => hour * 60 + minute;

const S = {
  laneEarly: session("lane-early", "Lane swim", at(6), at(8), [4, 8], "lane", { notes: "Adult" }),
  club: session("club", "Reserved", at(6), at(8), [1, 3], "reserved"),
  aquafit: session("aquafit", "Aquafit", at(7), at(7, 45), LEISURE, "fitness", {
    tag: "Shallow water",
    notes: "Adult · All levels",
  }),
  laneLate: session("lane-late", "Lane swim", at(8), at(9), [1, 4], "lane", { notes: "Adult" }),
  lessons: session("lessons", "Swim lessons", at(8), at(9), [5, 8], "lessons", { short: "Lessons" }),
  tots: session("tots", "Parent and tot swim", at(8), at(9, 30), LEISURE, "family", {
    short: "Parent & tot",
  }),
  publicSwim: session("public", "Public swim", at(13), at(15), LEISURE, "public", { tag: "All ages" }),
  family: session("family", "Family swim", at(18, 30), at(19, 30), LEISURE, "family", {
    tag: "All ages",
  }),
  laneEvening: session("lane-evening", "Lane swim", at(19), at(21), [1, 8], "lane", { notes: "Adult" }),
  aquafitEvening: session("aquafit-evening", "Aquafit", at(19, 30), at(20, 15), LEISURE, "fitness", {
    tag: "Shallow water",
    notes: "Adult · All levels",
  }),
};

const FULL = [S.laneEarly, S.club, S.aquafit, S.laneLate, S.lessons, S.tots, S.family, S.laneEvening];
const ALTERNATE = [
  S.laneEarly,
  S.club,
  S.laneLate,
  S.lessons,
  S.tots,
  S.publicSwim,
  S.laneEvening,
  S.aquafitEvening,
];

export const SAMPLE_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export type SampleDay = (typeof SAMPLE_DAYS)[number];

/** Each day in start-time order, which is the order every view lists them in. */
export const SAMPLE_WEEK: Record<SampleDay, SampleSession[]> = {
  Mon: FULL,
  Tue: ALTERNATE,
  Wed: FULL,
  Thu: ALTERNATE,
  Fri: FULL.filter((s) => s !== S.laneEvening),
};

export const SAMPLE_MONDAY = SAMPLE_WEEK.Mon;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function clock(minutes: number): { time: string; half: "AM" | "PM" } {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { time: `${h % 12 || 12}:${String(m).padStart(2, "0")}`, half: h < 12 ? "AM" : "PM" };
}

/** "6:00 AM" */
export function timeLabel(minutes: number): string {
  const { time, half } = clock(minutes);
  return `${time} ${half}`;
}

/** "6:00 AM – 8:00 AM" — both halves written out, as the printout does. */
export function printRange(s: SampleSession): string {
  return `${timeLabel(s.start)} – ${timeLabel(s.end)}`;
}

/** "6:00 – 8:00 AM" — for the screen, where the columns are narrow. */
export function shortRange(s: { start: number; end: number }): string {
  const a = clock(s.start);
  const b = clock(s.end);
  return a.half === b.half ? `${a.time} – ${b.time} ${b.half}` : `${a.time} ${a.half} – ${b.time} ${b.half}`;
}

/**
 * "Lane 4, Lane 5, Lane 6, Lane 7, Lane 8" — one by one, because that is how
 * the schedule and both printouts name them. Nothing in the product shortens a
 * run of lanes to a range.
 */
export function spaceList(s: SampleSession): string {
  if (!s.lanes) return s.space ?? "";
  const [from, to] = s.lanes;
  return Array.from({ length: to - from + 1 }, (_, i) => `Lane ${from + i}`).join(", ");
}

/** "Lanes 4–8" — for the page's own legends, which are not copies of a product surface. */
export function spaceRange(s: SampleSession): string {
  if (!s.lanes) return s.space ?? "";
  const [from, to] = s.lanes;
  return from === to ? `Lane ${from}` : `Lanes ${from}–${to}`;
}

/**
 * The week as the board draws it: one row per distinct time band, a column per
 * day, and every session in that band on that day as its own box — so lane swim
 * and the club, which share 6 to 8, share a row.
 */
export function boardRows(days: readonly SampleDay[]) {
  const bands = new Map<string, { start: number; end: number }>();
  for (const day of days) {
    for (const s of SAMPLE_WEEK[day]) bands.set(`${s.start}-${s.end}`, { start: s.start, end: s.end });
  }
  return [...bands.values()]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((band) => ({
      ...band,
      cells: days.map((day) =>
        SAMPLE_WEEK[day].filter((s) => s.start === band.start && s.end === band.end)
      ),
    }));
}
