"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ChevronRight, Settings2 } from "lucide-react";
import { useScheduleRange } from "@/hooks/useScheduleRange";
import { useWeekReviews } from "@/hooks/useWeekReviews";
import { getWeekStart, getWeekEnd, parseDate, sessionWeekStart, toSessionTime, localDateString } from "@/lib/utils/dates";
import { deriveScheduleStatus, SCHEDULE_STATUS_META } from "@/lib/schedule/scheduleStatus";
import { WEEK_REVIEW_STATUS_META } from "@/lib/schedule/weekReviewStatus";
import { cn } from "@/lib/utils/cn";
import type { CommandScheduleGroup } from "./types";

/** Weeks fetched per page — 12 * 7 = 84 days, safely under /api/sessions/expand's 120-day cap. */
const PAGE_WEEKS = 12;

interface WeekListPanelProps {
  scheduleGroup: CommandScheduleGroup;
  facilityId: string;
  onSelectWeek: (weekStart: Date) => void;
}

/**
 * Landing view for a selected schedule: every week is a row, not a single
 * navigator you page through one at a time. "Schedules are built week by
 * week" — this is where that starts, and clicking a row is how you get to
 * the actual week editor (the same grid/list/map views as before, just
 * entered here instead of via prev/next).
 */
export default function WeekListPanel({ scheduleGroup, facilityId, onSelectWeek }: WeekListPanelProps) {
  const [filter, setFilter] = useState<"upcoming" | "past">("upcoming");

  const today = new Date();
  const status = deriveScheduleStatus(
    {
      status: scheduleGroup.status,
      startsOn: scheduleGroup.startsOn,
      endsOn: scheduleGroup.endsOn,
      updatedAt: scheduleGroup.updatedAt,
      publishedAt: scheduleGroup.publishedAt,
    },
    format(today, "yyyy-MM-dd")
  );
  const meta = SCHEDULE_STATUS_META[status];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-semibold text-foreground truncate">{scheduleGroup.name}</h2>
          <span className={cn("shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", meta.className)}>
            {meta.label}
          </span>
        </div>
        <Link
          href={scheduleGroup.settingsHref}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-blue-600 dark:hover:text-blue-300 hover:bg-muted transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Settings
        </Link>
      </div>

      <div className="flex gap-1 px-4 pt-3">
        {(["upcoming", "past"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize",
              filter === value ? "bg-gray-900 text-white" : "bg-muted text-muted-foreground hover:bg-border"
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {/* Keyed so switching schedule or filter starts pagination fresh
          rather than carrying over however many pages were loaded before. */}
      <WeekListBody
        key={`${scheduleGroup.id}:${filter}`}
        scheduleGroupId={scheduleGroup.id}
        facilityId={facilityId}
        filter={filter}
        startsOn={scheduleGroup.startsOn}
        endsOn={scheduleGroup.endsOn}
        onSelectWeek={onSelectWeek}
      />
    </div>
  );
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

interface WeekListBodyProps {
  scheduleGroupId: string;
  facilityId: string;
  filter: "upcoming" | "past";
  startsOn: string | null;
  endsOn: string | null;
  onSelectWeek: (weekStart: Date) => void;
}

function WeekListBody({ scheduleGroupId, facilityId, filter, startsOn, endsOn, onSelectWeek }: WeekListBodyProps) {
  const [pages, setPages] = useState(1);

  const todayWeek = getWeekStart(new Date());
  const startsOnWeek = startsOn ? getWeekStart(parseDate(startsOn)) : null;
  const endsOnWeek = endsOn ? getWeekStart(parseDate(endsOn)) : null;

  // Pure date math — no fetch needed to know which weeks exist to page
  // through; each chunk of PAGE_WEEKS becomes one independently-fetched
  // WeekWindow below.
  const weekStarts: Date[] = [];
  const totalWeeks = pages * PAGE_WEEKS;
  if (filter === "upcoming") {
    for (let i = 0; i < totalWeeks; i++) {
      const w = addDays(todayWeek, i * 7);
      if (endsOnWeek && w > endsOnWeek) break;
      weekStarts.push(w);
    }
  } else {
    for (let i = 1; i <= totalWeeks; i++) {
      const w = addDays(todayWeek, -i * 7);
      if (startsOnWeek && w < startsOnWeek) break;
      weekStarts.push(w);
    }
  }

  const nextCandidate =
    filter === "upcoming" ? addDays(todayWeek, totalWeeks * 7) : addDays(todayWeek, -(totalWeeks + 1) * 7);
  const hasMore =
    weekStarts.length === totalWeeks &&
    (filter === "upcoming" ? !endsOnWeek || nextCandidate <= endsOnWeek : !startsOnWeek || nextCandidate >= startsOnWeek);

  if (weekStarts.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground/70">
        {filter === "past" ? "No earlier weeks." : "No upcoming weeks."}
      </p>
    );
  }

  const chunks: Date[][] = [];
  for (let i = 0; i < weekStarts.length; i += PAGE_WEEKS) {
    chunks.push(weekStarts.slice(i, i + PAGE_WEEKS));
  }

  return (
    <div className="px-2 py-2">
      {chunks.map((chunk) => (
        <WeekWindow
          key={chunk[0].toISOString()}
          scheduleGroupId={scheduleGroupId}
          facilityId={facilityId}
          weekStarts={chunk}
          onSelectWeek={onSelectWeek}
        />
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={() => setPages((p) => p + 1)}
          className="w-full py-2.5 text-center text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
        >
          {filter === "upcoming" ? "Load more weeks" : "Load earlier weeks"}
        </button>
      )}
    </div>
  );
}

interface WeekWindowProps {
  scheduleGroupId: string;
  facilityId: string;
  /** Sunday of every week this window renders, in the order they should appear. */
  weekStarts: Date[];
  onSelectWeek: (weekStart: Date) => void;
}

/**
 * One fetch, one bounded window of weeks. Kept separate from WeekListBody so
 * each page of the list is its own component instance with its own
 * useScheduleRange call — the number of pages varies at runtime, and this is
 * how that stays legal under the rules of hooks without a multi-range fetch
 * primitive.
 */
function WeekWindow({ scheduleGroupId, facilityId, weekStarts, onSelectWeek }: WeekWindowProps) {
  const rangeStart = weekStarts[0];
  const rangeEnd = getWeekEnd(weekStarts[weekStarts.length - 1]);
  const { data, isLoading } = useScheduleRange({ scheduleGroupId, facilityId, rangeStart, rangeEnd });
  const { byWeekStart: reviewByWeekStart } = useWeekReviews(scheduleGroupId, rangeStart, rangeEnd);

  const countsByWeek = new Map<number, number>();
  for (const session of data ?? []) {
    const key = sessionWeekStart(session.start).getTime();
    countsByWeek.set(key, (countsByWeek.get(key) ?? 0) + 1);
  }

  const todayWeek = getWeekStart(new Date());

  return (
    <div>
      {weekStarts.map((weekStart) => {
        const weekEnd = getWeekEnd(weekStart);
        const isThisWeek = weekStart.getTime() === todayWeek.getTime();
        // `weekStart` is a viewer-owned local Date (from getWeekStart); the
        // counts above are bucketed by session-occurrence (UTC-slot) week
        // starts. Re-encode via toSessionTime before comparing — the same
        // convention bridge useScheduleRange itself uses at its fetch
        // boundary — rather than comparing epochs across the two directly,
        // which is only right when the server happens to run in UTC.
        const count = countsByWeek.get(toSessionTime(weekStart).getTime()) ?? 0;
        const reviewStatus = reviewByWeekStart.get(localDateString(weekStart))?.status ?? "pending";
        const reviewMeta = WEEK_REVIEW_STATUS_META[reviewStatus];

        return (
          <button
            key={weekStart.toISOString()}
            type="button"
            onClick={() => onSelectWeek(weekStart)}
            className="w-full flex items-center justify-between gap-3 px-3 py-3 rounded-lg text-left hover:bg-muted transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">
                {format(weekStart, "EEE, MMM d")} – {format(weekEnd, "EEE, MMM d, yyyy")}
              </span>
              {isThisWeek && (
                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 dark:text-blue-300 border border-blue-200">
                  This week
                </span>
              )}
              <span className={cn("shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", reviewMeta.className)}>
                {reviewMeta.label}
              </span>
            </div>
            <div className="shrink-0 flex items-center gap-2 text-xs text-muted-foreground/70">
              {isLoading ? "…" : count === 0 ? "No sessions" : `${count} session${count === 1 ? "" : "s"}`}
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
