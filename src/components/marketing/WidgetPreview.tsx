"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  LayoutGrid,
  List,
  Columns3,
  Table2,
  Image as ImageIcon,
  Pause,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import FacilityMapSvg from "@/components/facility-maps/renderer/FacilityMapSvg";
import { SAMPLE_POOL, statusMapFor } from "./sampleFacilities";
import {
  SAMPLE_DAYS,
  SAMPLE_MONDAY,
  SAMPLE_WEEK,
  boardRows,
  shortRange,
  spaceList,
  spaceRange,
  timeLabel,
  type Tone,
} from "./sampleWeek";

type View = "grid" | "list" | "map" | "board" | "floorplan";

/** Mirrors ScheduleHeaderBar's OPTIONS — same values, order and icons as the real widget toggle. */
const VIEWS: { value: View; label: string; icon: typeof LayoutGrid; caption: string }[] = [
  {
    value: "grid",
    label: "Grid",
    icon: LayoutGrid,
    caption: "The whole week, one column per day.",
  },
  {
    value: "list",
    label: "List",
    icon: List,
    caption: "Day by day. Easiest to read on a phone.",
  },
  {
    value: "map",
    label: "Map",
    icon: Columns3,
    caption: "Lanes across, time down. One day, and what's on in each lane.",
  },
  {
    value: "board",
    label: "Board",
    icon: Table2,
    caption: "Times down the side, days across, like the printed schedule patrons know.",
  },
  {
    value: "floorplan",
    label: "Floorplan",
    icon: ImageIcon,
    caption: "Your building as you drew it, with what's on in each space.",
  },
];

/**
 * One colour per activity, the way a session takes its template's colour in the
 * product. Fixed light fills with dark text rather than theme tokens: the text
 * sits on the fill, not on the page, so it must not flip with the theme.
 */
const TONES: Record<Tone, { bar: string; block: string }> = {
  lane: { bar: "border-l-blue-500", block: "bg-blue-100 border-blue-300 text-blue-950" },
  reserved: { bar: "border-l-gray-400", block: "bg-gray-200 border-gray-300 text-gray-700" },
  fitness: { bar: "border-l-teal-500", block: "bg-teal-100 border-teal-300 text-teal-950" },
  lessons: { bar: "border-l-amber-500", block: "bg-amber-100 border-amber-300 text-amber-950" },
  family: { bar: "border-l-violet-500", block: "bg-violet-100 border-violet-300 text-violet-950" },
  public: { bar: "border-l-emerald-500", block: "bg-emerald-100 border-emerald-300 text-emerald-950" },
};

/** The lane view shows the morning, 6:00 to 9:30. */
const MAP_START = 6 * 60;
const MAP_END = 9 * 60 + 30;
const MAP_HOURS = [6, 7, 8, 9].map((h) => h * 60);
const LANES = [1, 2, 3, 4, 5, 6, 7, 8];
const morning = SAMPLE_MONDAY.filter((s) => s.start < MAP_END);
const pct = (minutes: number) => ((minutes - MAP_START) / (MAP_END - MAP_START)) * 100;

/** What the floorplan is showing: the sample pool at 7:10 on the same Monday. */
const FLOORPLAN_MOMENT = SAMPLE_POOL.moments[0];
const upNext = SAMPLE_MONDAY.filter((s) => s.start === 8 * 60);

/** How long each view stays up while the sample is rotating. */
const ROTATE_MS = 4000;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Interactive sample of the embeddable schedule widget, mirroring the real
 * widget's header bar + view toggle (see ScheduleHeaderBar). No live data: every
 * view reads the one sample week in `sampleWeek.ts`, so the five of them — and
 * the printout further down the page — describe the same Monday.
 *
 * This is the hero image, so two things follow. The caption sits *inside* the
 * card, under the widget: the hero is a solid blue field and a caption outside
 * the card would need its own colours for that one placement. And the widget
 * title is a paragraph, not a heading — the only heading above it is the h1.
 *
 * Opens on the lane view: it is the one the headline is about. The floorplan
 * tab is not a drawing of the floorplan — it is the product's own renderer
 * over the sample pool the section below shows.
 *
 * ## Rotation
 *
 * The views advance on their own every ROTATE_MS, in the toggle's order. Four
 * rules keep that from being a nuisance:
 *
 *  - Choosing a view stops it. Someone who clicked "Board" wants to read the
 *    board, not watch it leave four seconds later.
 *  - It holds while the pointer or keyboard focus is inside the widget —
 *    unless the visitor pressed Play, which is them asking for it to move. The
 *    pointer is over the button at that moment and focus stays on it, so a
 *    hold that applied then would make Play look broken.
 *  - There is a Pause / Play button. Content that moves by itself for more than
 *    five seconds needs one (WCAG 2.2.2).
 *  - With "reduce motion" set in the OS it does not start. Play still works,
 *    because pressing it is asking for the motion.
 *
 * ## Height
 *
 * The view area and the caption have fixed minimum heights, and every view is
 * built to fit inside them. Without that, each change of view moves the whole
 * page under the hero. Adding a row to a view means checking it still fits at
 * 320, 390 and 1280px — a view that outgrows the box brings the jump back.
 */
export default function WidgetPreview() {
  const [view, setView] = useState<View>("map");
  const active = VIEWS.find((v) => v.value === view)!;

  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false
  );
  /** null until the visitor presses Pause or Play, or picks a view. */
  const [choice, setChoice] = useState<boolean | null>(null);
  const [held, setHeld] = useState(false);
  const playing = choice ?? !reducedMotion;
  const holding = held && choice === null;

  useEffect(() => {
    if (!playing || holding) return;
    const id = window.setInterval(() => {
      setView((current) => {
        const i = VIEWS.findIndex((v) => v.value === current);
        return VIEWS[(i + 1) % VIEWS.length].value;
      });
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [playing, holding]);

  return (
    <div
      className="mx-auto max-w-xl text-left"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {/* Browser chrome to sell "this lives on your own site" */}
      <div className="rounded-t-xl bg-card border border-border border-b-0 px-4 py-2.5 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 bg-muted rounded-md border border-border px-3 py-1 text-xs text-muted-foreground/70">
          yourcentre.ca/schedule
        </div>
      </div>

      <div className="border border-border rounded-b-xl bg-card p-4 sm:p-6">
        {/* The widget itself */}
        <div className="rounded-xl overflow-hidden border border-border">
          <div className="bg-blue-600 px-3 sm:px-4 py-3 flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
            <p className="text-white font-semibold text-sm">Drop-in Schedule</p>
            <div
              role="group"
              aria-label="Schedule view"
              className="inline-flex gap-0.5 rounded-full p-0.5 bg-white/20"
            >
              {VIEWS.map((option) => {
                const Icon = option.icon;
                const isActive = view === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setView(option.value);
                      setChoice(false);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                      isActive ? "bg-card text-blue-700 dark:text-blue-300" : "text-white/90 hover:text-white"
                    )}
                    aria-pressed={isActive}
                    aria-label={option.label}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            key={view}
            className="p-3 sm:p-4 bg-muted min-h-[22rem] animate-in fade-in duration-300 motion-reduce:animate-none"
          >
            {view === "grid" && <GridView />}
            {view === "list" && <ListView />}
            {view === "map" && <LaneView />}
            {view === "board" && <BoardView />}
            {view === "floorplan" && <FloorplanSample />}
          </div>
        </div>

        <div className="mt-4 flex items-start gap-3">
          {/* Announced only when the visitor is driving: a live region that
              speaks every four seconds is worse than one that says nothing. */}
          <p
            className="flex-1 min-h-20 sm:min-h-10 text-sm text-muted-foreground"
            aria-live={playing ? "off" : "polite"}
          >
            <span className="font-semibold text-foreground">Sample schedule.</span>{" "}
            {active.caption}
          </p>
          <button
            type="button"
            onClick={() => setChoice(!playing)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={playing ? "Pause the rotating views" : "Play the rotating views"}
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {playing ? "Pause" : "Play"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
      {children}
    </p>
  );
}

/**
 * Days that do not fit a phone are dropped from the right rather than squeezed:
 * five columns at 390px leave about 55px each, which is not enough for a name.
 */
const PHONE_DAYS = 3;

function GridView() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
      {SAMPLE_DAYS.map((day, i) => (
        <div key={day} className={cn("min-w-0", i >= PHONE_DAYS && "hidden sm:block")}>
          <p className="text-[11px] font-semibold text-muted-foreground text-center mb-1">{day}</p>
          <div className="space-y-1">
            {SAMPLE_WEEK[day].map((s) => (
              <div
                key={s.key}
                className={cn(
                  "bg-card border border-border border-l-2 rounded px-1.5 py-1 min-w-0",
                  TONES[s.tone].bar
                )}
              >
                <p className="text-[10px] font-medium leading-tight text-foreground truncate">{s.short}</p>
                <p className="text-[9px] leading-tight text-muted-foreground tabular-nums">
                  {timeLabel(s.start)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListView() {
  return (
    <div>
      <Heading>Today · Monday</Heading>
      <div className="space-y-1">
        {SAMPLE_MONDAY.map((s) => (
          <div
            key={s.key}
            className={cn(
              "flex items-center gap-2 bg-card rounded border border-border border-l-2 px-2 py-2 sm:py-1.5",
              TONES[s.tone].bar
            )}
          >
            <span className="w-[5.75rem] shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {shortRange(s)}
            </span>
            <span className="shrink-0 text-xs font-medium text-foreground">{s.name}</span>
            {s.tag && (
              <span className="hidden sm:inline shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                {s.tag}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground">
              {spaceList(s)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One column per space, blocks placed by time of day — same idea as
 * WeeklyScheduleMap, which draws a session once in every lane it holds. The
 * club has lanes 1–3 until 8, so lane swim is drawn in 4–8 for those two
 * hours; from 8 lessons take 5–8 and lane swim is drawn in 1–4.
 *
 * The leisure pool is a ninth column from `sm` up. Nine columns do not fit a
 * phone, and the lanes are the ones the headline is about.
 */
function LaneView() {
  const columns = [
    ...LANES.map((lane) => ({
      key: `lane-${lane}`,
      label: String(lane),
      prefix: "Lane ",
      phone: true,
      sessions: morning.filter((s) => s.lanes && lane >= s.lanes[0] && lane <= s.lanes[1]),
    })),
    {
      key: "leisure",
      label: "Leisure",
      prefix: "",
      phone: false,
      sessions: morning.filter((s) => s.space === "Leisure pool"),
    },
  ];

  return (
    <div>
      <Heading>Today · Monday</Heading>
      <div className="flex gap-1.5">
        <div className="relative w-7 shrink-0 h-[16.5rem] mt-5">
          {MAP_HOURS.map((minutes) => (
            <span
              key={minutes}
              style={{ top: `${pct(minutes)}%` }}
              className="absolute left-0 text-[9px] leading-none text-muted-foreground tabular-nums"
            >
              {timeLabel(minutes).replace(":00", "")}
            </span>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-8 sm:grid-cols-9 gap-1">
          {columns.map((column) => (
            <div key={column.key} className={cn("min-w-0", !column.phone && "hidden sm:block")}>
              <p className="text-[10px] font-medium text-muted-foreground text-center mb-1 h-4 truncate">
                <span className="hidden sm:inline">{column.prefix}</span>
                {column.label}
              </p>
              <div className="relative bg-card border border-border rounded-md h-[16.5rem] overflow-hidden">
                {MAP_HOURS.slice(1).map((minutes) => (
                  <span
                    key={minutes}
                    aria-hidden
                    style={{ top: `${pct(minutes)}%` }}
                    className="absolute inset-x-0 border-t border-border/70"
                  />
                ))}
                {column.sessions.map((s) => (
                  <div
                    key={s.key}
                    style={{ top: `${pct(s.start)}%`, height: `calc(${pct(s.end) - pct(s.start)}% - 2px)` }}
                    className={cn(
                      "absolute inset-x-px rounded border px-0.5 sm:px-[3px] py-1 overflow-hidden",
                      TONES[s.tone].block
                    )}
                  >
                    {/* Eight lanes on a phone leave ~30px a column, where a
                        horizontal label breaks mid-word. Upright text reads
                        down the lane instead. */}
                    <p className="text-[9px] sm:text-[7.5px] sm:tracking-tight font-medium leading-tight whitespace-nowrap sm:whitespace-normal [writing-mode:vertical-rl] sm:[writing-mode:horizontal-tb]">
                      {s.short}
                    </p>
                    <p className="hidden sm:block text-[7px] leading-tight opacity-80 tabular-nums">
                      {timeLabel(s.start).replace(" AM", "")}–{timeLabel(s.end).replace(" AM", "")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Time bands down, days across — the shape of WeeklyScheduleBoard. */
function BoardView() {
  const rows = boardRows(SAMPLE_DAYS);
  return (
    <table className="w-full table-fixed border-collapse text-[9px]">
      <thead>
        <tr>
          <th className="w-[4.75rem] sm:w-24 p-1 text-left font-semibold text-muted-foreground" />
          {SAMPLE_DAYS.map((day, i) => (
            <th
              key={day}
              className={cn(
                "p-1 text-center text-[11px] font-semibold text-muted-foreground",
                i >= PHONE_DAYS && "hidden sm:table-cell"
              )}
            >
              {day}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.start}-${row.end}`}>
            <th
              scope="row"
              className="p-1 text-left font-medium text-muted-foreground whitespace-nowrap align-top tabular-nums"
            >
              {shortRange(row)}
            </th>
            {row.cells.map((cell, i) => (
              <td key={i} className={cn("p-0.5 align-top", i >= PHONE_DAYS && "hidden sm:table-cell")}>
                <div className="space-y-0.5">
                  {cell.map((s) => (
                    <div
                      key={s.key}
                      className={cn(
                        "rounded border border-border border-l-2 bg-card px-1 py-1.5 leading-tight text-foreground truncate",
                        TONES[s.tone].bar
                      )}
                    >
                      {s.short}
                    </div>
                  ))}
                </div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The product's own map over the sample pool, with the two lists the real
 * legend carries under it: what is on now and what is next.
 */
function FloorplanSample() {
  return (
    <div>
      <Heading>Monday · {FLOORPLAN_MOMENT.label}</Heading>
      <FacilityMapSvg
        className="mx-auto max-w-[22rem] rounded-md overflow-hidden border border-border"
        canvasWidth={SAMPLE_POOL.canvasWidth}
        canvasHeight={SAMPLE_POOL.canvasHeight}
        shapes={SAMPLE_POOL.shapes}
        statusBySpaceId={statusMapFor(FLOORPLAN_MOMENT)}
      />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <LegendList
          title="On now"
          rows={FLOORPLAN_MOMENT.entries.map((entry) => ({
            key: entry.where,
            where: entry.where,
            what: entry.title,
          }))}
        />
        <LegendList
          title="Up next · 8:00 AM"
          rows={upNext.map((s) => ({ key: s.key, where: spaceRange(s), what: s.short }))}
        />
      </div>
    </div>
  );
}

function LegendList({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; where: string; what: string }[];
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold text-foreground mb-1">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.key} className="flex gap-1.5 text-[10px] leading-tight">
            <span className="shrink-0 text-muted-foreground">{row.where}</span>
            <span className="min-w-0 truncate text-foreground">{row.what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
