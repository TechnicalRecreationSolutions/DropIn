"use client";

import { useMemo } from "react";
import { CalendarRange } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/dashboard/StatCard";
import { useWeeklySchedule } from "@/hooks/useScheduleRange";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getWeekStart, localDateString, sessionDateString } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface WeekTileProps {
  orgId: string;
  facilityId: string;
  departmentId?: string;
  scheduleGroupId?: string;
}

/**
 * The third tile: this week, as a shape.
 *
 * The other two look backwards — views and changes over the last 30 days, both
 * linking to a reporting page. This one looks at the week the user is actually
 * working on, and its link lands on exactly what it describes: the command
 * centre opens on the current week, so there is no "now find the right week"
 * step between the number and the thing.
 *
 * The seven bars are the point rather than the total. "43 sessions" says
 * nothing a coordinator can act on; a Tuesday with no bar is a hole in the
 * week, and holes are what this job is mostly about finding.
 *
 * It shares its fetch with the today ribbon above — same scope, same week, so
 * `useWeeklySchedule` serves both from one request — and that request uses the
 * **same query key the command centre opens with**, so clicking through
 * renders from cache rather than re-fetching.
 */
export default function WeekTile({ orgId, facilityId, departmentId, scheduleGroupId }: WeekTileProps) {
  // Viewer-owned dates: built with local getters, and compared against
  // occurrences via the YYYY-MM-DD string both conventions agree on rather than
  // by Date arithmetic across the two. `getWeekStart` is Sunday-based.
  const { weekStart, dayKeys } = useMemo(() => {
    const start = getWeekStart(new Date());
    const keys: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      keys.push(localDateString(d));
    }
    return { weekStart: start, dayKeys: keys };
  }, []);

  const { data, isPending, isError } = useWeeklySchedule({
    orgId,
    facilityId,
    departmentId,
    scheduleGroupId,
    weekStart,
  });

  const counts = useMemo(() => {
    const byDay = new Map(dayKeys.map((k) => [k, 0]));
    for (const s of data ?? []) {
      const key = sessionDateString(s.start);
      if (byDay.has(key)) byDay.set(key, byDay.get(key)! + 1);
    }
    return dayKeys.map((k) => byDay.get(k) ?? 0);
  }, [data, dayKeys]);

  if (isPending || isError) {
    // No "—" placeholder: a dash where a number goes reads as "none", and a
    // wrong answer held briefly is worse than an obvious absence.
    return (
      <Card className="h-full gap-2 px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-full" />
      </Card>
    );
  }

  const total = counts.reduce((a, b) => a + b, 0);
  const todayKey = localDateString();
  const todayIndex = dayKeys.indexOf(todayKey);
  const emptyDays = counts.map((c, i) => (c === 0 ? i : -1)).filter((i) => i >= 0);

  return (
    <StatTile
      icon={CalendarRange}
      label="This week"
      value={String(total)}
      hint={emptyLabel(emptyDays)}
      href={commandCentreHref({ facilityId, departmentId, scheduleGroupId })}
      visual={
        // The bars and their letters share one 28px box — the same height the
        // sparkline on the neighbouring tile occupies. Stacked as two
        // independent rows they added 11px to every tile in the row, since a
        // grid row is as tall as its tallest cell.
        <div className="flex h-7 flex-col justify-end gap-px">
          <WeekBars counts={counts} todayIndex={todayIndex} />
          <WeekBarLegend todayIndex={todayIndex} />
        </div>
      }
    />
  );
}

/**
 * The hint under the bars.
 *
 * It names the gaps rather than restating the total, because a gap is the one
 * thing on this tile anybody does something about. Named while there are few
 * enough to name; counted once the list would be longer than the tile.
 *
 * "Nothing on Sunday" is a statement of fact, not a complaint — plenty of
 * buildings are shut on a Sunday, and the tile does not know which.
 */
function emptyLabel(emptyDays: number[]): string {
  if (emptyDays.length === 0) return "Something on every day";
  if (emptyDays.length >= 3) return `${emptyDays.length} days with nothing`;
  const names = emptyDays.map((i) => DAY_NAME[i]);
  return `Nothing on ${names.join(" or ")}`;
}

/**
 * Seven bars, one per day, drawn at their true proportions against a baseline.
 *
 * Heights are true proportions, with one exception: a non-zero day is never
 * drawn thinner than 6% (~2px here). That is not a magnitude floor dressed up —
 * it exists because the distinction this chart has to keep is "a little" versus
 * "none", and one session out of a twenty-session Saturday renders at 1.4px,
 * which is indistinguishable from an empty day. Everything above that floor is
 * to scale, so the relative heights still mean what they look like.
 *
 * The baseline rule underneath is what lets a zero read as a zero rather than
 * as a bar that failed to render.
 */
function WeekBars({ counts, todayIndex }: { counts: number[]; todayIndex: number }) {
  const max = Math.max(...counts, 1);

  return (
    <div
      className="flex min-h-0 flex-1 items-end gap-[2px] border-b border-border"
      role="img"
      aria-label={counts
        .map((c, i) => `${DAY_NAME[i]}: ${c} ${c === 1 ? "session" : "sessions"}`)
        .join(", ")}
    >
      {counts.map((c, i) => (
        <div
          key={i}
          title={`${DAY_NAME[i]}: ${c}`}
          style={{
            height: c === 0 ? 0 : `${Math.max(6, (c / max) * 100)}%`,
            // --viz-cat-1, the project's own categorical slot 1 (globals.css),
            // not shadcn's greyscale `--primary`. It is the colour the
            // analytics charts and the sparkline next door already use for a
            // single series, and it flips for dark mode with them.
            //
            // Today is the full value; the rest are mixed toward the card
            // surface rather than given an alpha, so they stay opaque and the
            // 2px gaps between bars read as gaps rather than as seams.
            backgroundColor:
              i === todayIndex
                ? "var(--viz-cat-1)"
                : "color-mix(in srgb, var(--viz-cat-1) 45%, var(--card))",
          }}
          // Today is also findable by position and by the bold day letter
          // below — never by colour alone.
          className="flex-1 rounded-t-[2px]"
        />
      ))}
    </div>
  );
}

/** The day letters, under the bars — without them "today is darker" would be
 *  colour alone, and no bar would be nameable. */
function WeekBarLegend({ todayIndex }: { todayIndex: number }) {
  return (
    <div className="flex shrink-0 gap-[2px]" aria-hidden>
      {DAY_LETTER.map((d, i) => (
        <span
          key={i}
          className={cn(
            "flex-1 text-center text-[9px] leading-none",
            i === todayIndex ? "font-bold text-foreground" : "text-muted-foreground/70"
          )}
        >
          {d}
        </span>
      ))}
    </div>
  );
}
