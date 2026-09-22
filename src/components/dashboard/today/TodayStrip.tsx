"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import Link from "next/link";
import { CalendarPlus, CircleDot } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { useWeeklySchedule } from "@/hooks/useScheduleRange";
import {
  formatSessionTime,
  getWeekStart,
  minutesOfDayIn,
  minutesToTime,
  nowAsSessionTime,
  sessionDateString,
} from "@/lib/utils/dates";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { cn } from "@/lib/utils/cn";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { axisBounds, blockRect, hourTicks, packRows, positionPct, summarise } from "./todayGeometry";

/** Drawn width of one hour. The ribbon scrolls sideways rather than squeezing
 *  below this — a 14-hour day at 390px would otherwise give each hour 25px,
 *  and every block would be a nameless sliver. */
const PX_PER_HOUR = 76;

/** Rows of blocks the strip will draw before it starts counting the rest. */
const MAX_ROWS = 4;

interface TodayStripProps {
  orgId: string;
  facilityId: string;
  facilityName: string;
  /** The sidebar's current narrowing, so the strip shows the same slice of the
   *  org as everything else on the page. */
  departmentId?: string;
  scheduleGroupId?: string;
  /** Absent for roles without `session:write` — see rubric B4. */
  newSessionHref?: string;
}

type Placed = {
  startMin: number;
  endMin: number;
  session: ExpandedSession;
  /** `key` is not unique once residual.ts splits a block into bands. */
  reactKey: string;
};

/**
 * The first thing on the Overview: today's schedule at the selected facility,
 * drawn against a time axis.
 *
 * Why a picture and not a list. The question this answers — "is the building
 * covered, and where are the holes?" — is a question about *shape*. A list of
 * eight rows makes you reconstruct that shape in your head; a ribbon hands it
 * over. The gaps are the point, which is also why the axis is continuous
 * rather than one column per session.
 *
 * Why client-side. It reads through `useScheduleRange`, i.e. the same
 * `/api/sessions/expand` cache family every schedule surface uses. Fetching it
 * on the server would be a second expansion of the same data, and would put a
 * ~200ms query in front of the page's static shell for content the user may
 * scroll past. This way the first navigation to the schedule afterwards is
 * already warm.
 */
export default function TodayStrip({
  orgId,
  facilityId,
  facilityName,
  departmentId,
  scheduleGroupId,
  newSessionHref,
}: TodayStripProps) {
  // Real local Dates: useWeeklySchedule re-encodes them into the session-Date
  // convention itself, and doing it here as well would shift them twice.
  const { weekStart, todayKey, nowMin } = useMemo(() => {
    const sessionNow = nowAsSessionTime();
    return {
      weekStart: getWeekStart(new Date()),
      todayKey: sessionDateString(sessionNow),
      nowMin: minutesOfDayIn(sessionNow),
    };
    // Recomputed only on mount: the strip is a snapshot of "today", and a
    // dependency on the clock would re-issue the query every render.
  }, []);

  // The whole week, not just today — then filtered to today below.
  //
  // Three things come out of that. The WeekTile beside the stat row wants the
  // same week at the same scope, so the two surfaces share one request instead
  // of making two. This is also the exact query key the command centre opens
  // with, so clicking through to the schedule renders from cache. And a
  // day-wide range is not cheaper in any way that matters: expansion is
  // O(occurrences) over a range the server caps at 120 days either way.
  const { data, isPending, isError } = useWeeklySchedule({
    orgId,
    facilityId,
    departmentId,
    scheduleGroupId,
    weekStart,
  });

  const placed: Placed[] = useMemo(() => {
    const out: Placed[] = [];
    (data ?? []).forEach((s, i) => {
      // The fetch is a whole week (see above), so this filter is what makes the
      // strip about today. Matched on the occurrence's own start date rather
      // than on a range boundary: expansion is inclusive at both ends and a
      // session can run past midnight, so "starts today" is the only reading
      // that puts each occurrence on exactly one day.
      if (sessionDateString(s.start) !== todayKey) return;
      const startMin = minutesOfDayIn(s.start);
      // An occurrence whose end reads *earlier* than its start ran past
      // midnight; it is drawn to the end of the day rather than as a
      // negative-width block. A zero-length one is left at zero and widened to
      // the minimum tap target by `blockRect` — stretching it to midnight would
      // turn a data glitch into a block that claims to hold the building all
      // evening, and would report it as "on now" for hours.
      const rawEnd = minutesOfDayIn(s.end);
      const endMin = rawEnd < startMin ? 24 * 60 : rawEnd;
      out.push({ startMin, endMin, session: s, reactKey: `${s.key}_${i}` });
    });
    return out;
  }, [data, todayKey]);

  if (isPending) {
    return (
      <Card className="gap-3 px-4 py-4 sm:px-5">
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="gap-1 px-4 py-4 sm:px-5">
        <p className="text-sm font-medium text-foreground">Today&rsquo;s schedule could not be loaded</p>
        <p className="text-sm text-muted-foreground">
          The rest of this page is still accurate. Reload to try again.
        </p>
      </Card>
    );
  }

  if (placed.length === 0) {
    return (
      <Card className="gap-1 px-4 py-6 text-center sm:px-5">
        <p className="text-sm font-medium text-foreground">Nothing runs at {facilityName} today</p>
        <p className="text-sm text-muted-foreground">
          {newSessionHref
            ? "An empty day is either a closure or a gap worth filling."
            : "An empty day is either a closure or a gap."}
        </p>
        {newSessionHref && (
          <Link
            href={newSessionHref}
            className="mx-auto mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            <CalendarPlus className="size-4" aria-hidden />
            Add a session
          </Link>
        )}
      </Card>
    );
  }

  const axis = axisBounds(placed, nowMin);
  const { rows, overflow } = packRows(placed, MAX_ROWS);
  const ticks = hourTicks(axis);
  const summary = summarise(placed, nowMin);
  const nowPct = nowMin >= axis.startMin && nowMin <= axis.endMin ? positionPct(nowMin, axis) : null;
  const widthPx = Math.round(((axis.endMin - axis.startMin) / 60) * PX_PER_HOUR);

  // Where the ribbon opens when it is wider than the screen.
  //
  // Centring on "now" is right while the day still has something in it. After
  // the last session ends it is exactly wrong: at 11pm the strip would open on
  // an empty evening, and a page that says "4 sessions today" above a blank
  // picture reads as a bug. So once nothing is running and nothing is left to
  // start, it opens at the beginning of the day it is describing.
  const dayHasMoreToCome = summary.onNow.length > 0 || summary.next !== null;
  const openAtPct = dayHasMoreToCome ? nowPct : 0;

  return (
    <Card className="gap-3 px-4 py-4 sm:px-5">
      <SummaryLine
        total={summary.total}
        onNow={summary.onNow.map((p) => p.session)}
        next={summary.next?.session ?? null}
        firstMin={summary.firstMin}
        lastMin={summary.lastMin}
      />

      <Ribbon
        axisStartMin={axis.startMin}
        axisEndMin={axis.endMin}
        widthPx={widthPx}
        nowPct={nowPct}
        openAtPct={openAtPct}
        ticks={ticks}
        rows={rows}
        nowMin={nowMin}
      />

      {overflow.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {overflow.length} more {overflow.length === 1 ? "session overlaps" : "sessions overlap"} these —
          open the schedule to see every lane.
        </p>
      )}
    </Card>
  );
}

/**
 * The sentence above the ribbon.
 *
 * It is deliberately a sentence and not a row of numbers: "3 running now,
 * 11 today" is read in one pass, where three tiles labelled Running / Today /
 * Next are three reads and a layout.
 */
function SummaryLine({
  total,
  onNow,
  next,
  firstMin,
  lastMin,
}: {
  total: number;
  onNow: ExpandedSession[];
  next: ExpandedSession | null;
  firstMin: number | null;
  lastMin: number | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-sm font-semibold text-foreground tabular-nums">
        {total} {total === 1 ? "session" : "sessions"} today
      </span>
      {firstMin !== null && lastMin !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {minutesToTime(firstMin)} &ndash; {minutesToTime(Math.min(lastMin, 24 * 60 - 1))}
        </span>
      )}
      <span className="ml-auto text-xs">
        {onNow.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <CircleDot className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            On now: {sessionDisplayLabel(onNow[0])}
            {onNow.length > 1 && <span className="text-muted-foreground">+{onNow.length - 1}</span>}
          </span>
        ) : next ? (
          <span className="text-muted-foreground">
            Next: <span className="font-medium text-foreground">{sessionDisplayLabel(next)}</span> at{" "}
            <span className="tabular-nums">{formatSessionTime(next.start)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Nothing left to start today</span>
        )}
      </span>
    </div>
  );
}

function Ribbon({
  axisStartMin,
  axisEndMin,
  widthPx,
  nowPct,
  openAtPct,
  ticks,
  rows,
  nowMin,
}: {
  axisStartMin: number;
  axisEndMin: number;
  widthPx: number;
  nowPct: number | null;
  openAtPct: number | null;
  ticks: number[];
  rows: Placed[][];
  nowMin: number;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const axis = { startMin: axisStartMin, endMin: axisEndMin };

  // On a phone the ribbon is several screens wide, and a strip that opens at
  // 6am when it is 4pm has shown the user the part of the day they can no
  // longer do anything about. The caller decides where "the useful part" is.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || openAtPct === null) return;
    const target = (openAtPct / 100) * el.scrollWidth - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, target);
  }, [openAtPct]);

  return (
    <div ref={scrollerRef} className="-mx-1 overflow-x-auto px-1 pb-1" data-testid="today-ribbon">
      <div className="relative" style={{ minWidth: `${widthPx}px` }}>
        {/* Hour gridlines and labels. Recessive on purpose — they are the
            backdrop the blocks are read against, not content of their own. */}
        <div className="relative h-4">
          {ticks.map((t) => (
            <span
              key={t}
              className={cn(
                "absolute top-0 text-[10px] tabular-nums text-muted-foreground/70",
                // Centred on its gridline, except at the two ends, where half
                // the label would sit outside the ribbon and be clipped by the
                // scroller.
                t <= axis.startMin ? "translate-x-0" : t >= axis.endMin ? "-translate-x-full" : "-translate-x-1/2"
              )}
              style={{ left: `${positionPct(t, axis)}%` }}
            >
              {tickLabel(t)}
            </span>
          ))}
        </div>

        <div className="relative rounded-lg bg-muted/40 py-1.5">
          {ticks.map((t) => (
            <span
              key={t}
              aria-hidden
              className="absolute inset-y-0 w-px bg-border"
              style={{ left: `${positionPct(t, axis)}%` }}
            />
          ))}

          {rows.map((row, i) => (
            <div key={i} className="relative mx-1 h-11" style={{ marginTop: i === 0 ? 0 : 4 }}>
              {row.map((p) => (
                <SessionBlock key={p.reactKey} placed={p} axis={axis} nowMin={nowMin} />
              ))}
            </div>
          ))}

          {nowPct !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-foreground/80"
              style={{ left: `${nowPct}%` }}
            >
              <span className="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-foreground" />
              <span className="sr-only">Now, {minutesToTime(nowMin)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * An axis tick's label.
 *
 * `minutesToTime` is defined over a clock — minutes 0 to 1439 — and the axis
 * has one value that is not a clock reading: 1440, the far edge of a day that
 * runs to midnight. Fed through unchanged it comes back as "12:00 PM", i.e.
 * noon, which is the one hour of the day it is furthest from.
 */
function tickLabel(minute: number): string {
  return minute >= 24 * 60 ? "Midnight" : minutesToTime(minute);
}

/** Staff-set template colours are `#rrggbb`; anything else is not interpolated
 *  into CSS. The column is staff-writable, and a value reaching `color-mix()`
 *  unchecked is a stylesheet someone else gets to write. */
const HEX = /^#[0-9a-fA-F]{6}$/;

function SessionBlock({ placed, axis, nowMin }: { placed: Placed; axis: { startMin: number; endMin: number }; nowMin: number }) {
  const { session } = placed;
  const { leftPct, widthPct } = blockRect(placed, axis);
  const isPast = placed.endMin <= nowMin;
  const isRunning = placed.startMin <= nowMin && nowMin < placed.endMin;
  const label = sessionDisplayLabel(session);
  const time = `${formatSessionTime(session.start)} – ${formatSessionTime(session.end)}`;

  // A staff-set template colour wins, so a schedule that is green on the public
  // page is green here too. Everything else takes `--viz-cat-1`, the project's
  // own categorical slot 1 (globals.css) — the same colour the analytics charts
  // and both tiles below use, and the reason this does not reach for shadcn's
  // `--primary`, which is greyscale and encodes nothing.
  //
  // Deliberately NOT `getSessionCardStyle`, which the public schedule views
  // use: that one mixes toward literal `white` and is only defined inside
  // `.org-theme`, so it renders light-on-light in dark mode out here.
  const tint =
    session.templateColor && HEX.test(session.templateColor) ? session.templateColor : "var(--viz-cat-1)";
  const style: CSSProperties = {
    left: `${leftPct}%`,
    width: `${widthPct}%`,
    ...(isPast
      ? {}
      : {
          backgroundColor: `color-mix(in srgb, ${tint} 18%, var(--card))`,
          borderColor: `color-mix(in srgb, ${tint} 50%, var(--card))`,
        }),
  };

  return (
    <Link
      href={`/dashboard/schedule/sessions/${session.sessionId}/edit`}
      title={`${label} · ${time}${session.spaceNames.length > 0 ? ` · ${session.spaceNames.join(", ")}` : ""}`}
      style={style}
      className={cn(
        "absolute inset-y-0 flex flex-col justify-center overflow-hidden rounded-md border px-2 py-1 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // A finished session is recessive but never invisible. `bg-muted` was
        // the obvious choice and the wrong one: the ribbon's own backdrop is
        // muted too, so the morning simply disappeared off a strip that still
        // claimed to show the whole day. `bg-card` recedes against the backdrop
        // by being *lighter* than it, which works in both themes.
        isPast ? "border-border bg-card text-muted-foreground" : "text-foreground",
        // Never colour alone: a running block is also ringed.
        isRunning && "ring-2 ring-foreground/40"
      )}
    >
      <span className="truncate text-xs font-medium leading-tight">{label}</span>
      <span className="truncate text-[10px] leading-tight tabular-nums opacity-80">{time}</span>
    </Link>
  );
}
