"use client";

import { useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils/cn";
import { useScheduleRange } from "@/hooks/useScheduleRange";
import { useDepartmentWeekHours } from "@/hooks/useDepartmentWeekHours";
import { format } from "date-fns";
import { getWeekEnd } from "@/lib/utils/dates";
import { DAY_LABELS_SHORT } from "@/lib/schedule/operating-hours";
import { occupancyKindLabel } from "@/lib/sessions/occupancy";
import { buildWeekOverview, formatHours } from "@/lib/schedule/weekOverview";
import CanvasShortcutList from "@/components/schedule/editing/CanvasShortcutList";

export type WeekPanelTab = "overview" | "help";

interface WeekPanelProps {
  /** Null keeps the panel closed; the tab name is what opened it. */
  tab: WeekPanelTab | null;
  onTabChange: (tab: WeekPanelTab | null) => void;
  facilityId: string;
  /** Null for a schedule that sits outside any department — no operating hours to compare against. */
  departmentId: string | null;
  weekStart: Date;
  /** False on a read-only surface: the editing tab is then not offered at all. */
  showHelp: boolean;
}

/**
 * The week panel — everything you *consult* while building, off the page.
 *
 * The left rail is for the things you place; this is for the things you read.
 * Both used to sit in that one column and the result was a rail you scrolled
 * past to reach the templates, which is the opposite of what a rail is for.
 *
 * Two tabs, because they answer the two questions a builder actually stops to
 * ask: **Overview** ("what have I got in this week, and how much of it") and
 * **How to edit** ("what does dragging that corner do"). Neither is something
 * to keep on screen while working, and both are wanted within one click of it.
 */
export default function WeekPanel({
  tab,
  onTabChange,
  facilityId,
  departmentId,
  weekStart,
  showHelp,
}: WeekPanelProps) {
  // The whole FACILITY's week, not this schedule group's. "What are we
  // offering" is a question about the building: the rental eating into a
  // drop-in block almost always lives under a different schedule group, and an
  // overview scoped to the open editor would quietly leave it out. Same query
  // key family as every other surface, so an edit refreshes it.
  const { data: sessions, isLoading: sessionsLoading } = useScheduleRange({
    facilityId,
    rangeStart: weekStart,
    rangeEnd: getWeekEnd(weekStart),
  });

  const { openByDay, holidaysThisWeek, hasHours, isLoading: hoursLoading } = useDepartmentWeekHours(
    departmentId,
    weekStart
  );

  const overview = useMemo(
    () => buildWeekOverview(sessions ?? [], openByDay),
    [sessions, openByDay]
  );

  const loading = sessionsLoading || hoursLoading;

  return (
    <Sheet open={tab !== null} onOpenChange={(next) => !next && onTabChange(null)}>
      <SheetContent side="right" className="sm:max-w-md w-full overflow-y-auto">
        <SheetHeader className="pb-0">
          <SheetTitle>This week</SheetTitle>
          <SheetDescription>
            {format(weekStart, "MMM d")} – {format(getWeekEnd(weekStart), "MMM d, yyyy")}
          </SheetDescription>
        </SheetHeader>

        {showHelp && (
          <div className="px-4 flex gap-1" role="tablist" aria-label="Week panel">
            {(["overview", "help"] as WeekPanelTab[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => onTabChange(value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                  tab === value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {value === "overview" ? "Overview" : "How to edit"}
              </button>
            ))}
          </div>
        )}

        <div className="px-4 pb-6">
          {tab === "help" ? (
            <CanvasShortcutList />
          ) : loading ? (
            <p className="text-sm text-muted-foreground py-6">Adding up the week…</p>
          ) : (
            <OverviewBody
              overview={overview}
              hasHours={hasHours}
              hasDepartment={!!departmentId}
              holidays={holidaysThisWeek}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OverviewBody({
  overview,
  hasHours,
  hasDepartment,
  holidays,
}: {
  overview: ReturnType<typeof buildWeekOverview>;
  hasHours: boolean;
  hasDepartment: boolean;
  holidays: { date: string; name: string; observance: string }[];
}) {
  if (overview.totalOccurrences === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6">
        Nothing is scheduled anywhere in this building this week.
      </p>
    );
  }

  const programmedShare =
    overview.openMinutes > 0 ? Math.round((overview.programmedMinutes / overview.openMinutes) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* How much of the open week has something in it. Hidden rather than
          guessed at when the department has no hours — a denominator nobody
          set is not a number worth printing. */}
      {overview.hasOpenHours ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Open hours
          </h3>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex h-2.5 bg-muted">
              <div
                className="bg-blue-600"
                style={{ width: `${Math.min(programmedShare, 100)}%` }}
                aria-hidden
              />
            </div>
            <dl className="divide-y divide-border">
              <Line term="Open" value={formatHours(overview.openMinutes)} />
              <Line
                term="Something running"
                value={formatHours(overview.programmedMinutes)}
                note={`${programmedShare}% of open`}
              />
              <Line
                term="Nothing running"
                value={formatHours(overview.unprogrammedMinutes)}
                note={overview.unprogrammedMinutes > 0 ? "open with an empty schedule" : undefined}
              />
              {overview.outsideOpenMinutes > 0 && (
                <Line
                  term="Outside open hours"
                  value={formatHours(overview.outsideOpenMinutes)}
                  note="scheduled while the department is shut"
                  warn
                />
              )}
            </dl>
          </div>
        </section>
      ) : (
        <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded-lg px-3 py-2">
          {hasDepartment
            ? hasHours
              ? "This department is closed all week, so there is nothing to compare against."
              : "Set this department's operating hours to see how much of the week is programmed."
            : "This schedule sits outside a department, so there are no operating hours to compare against."}
        </p>
      )}

      {/* The answer to "how much of each are we offering". */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          By kind
        </h3>
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-semibold px-3 py-2">Kind</th>
                <th className="text-right font-semibold px-3 py-2">Hours</th>
                <th className="text-right font-semibold px-3 py-2">Space-hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {overview.byKind.map((row) => (
                <tr key={row.kind}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{occupancyKindLabel(row.kind)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {row.sessions} {row.sessions === 1 ? "session" : "sessions"} · {row.occurrences}{" "}
                      {row.occurrences === 1 ? "time" : "times"} this week
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground whitespace-nowrap">
                    {formatHours(row.clockMinutes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                    {formatHours(row.spaceMinutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-snug">
          <strong className="text-foreground">Hours</strong> is time on the clock — two rentals in two
          spaces at once count once. <strong className="text-foreground">Space-hours</strong> multiply
          by the spaces held, so a two-hour booking of four lanes is eight. Drop-in figures are what is
          left after the bookings above them.
        </p>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          By day
        </h3>
        <div className="space-y-1">
          {overview.byDay.map((day) => {
            const busiest = Math.max(...overview.byDay.map((d) => d.spaceMinutes), 1);
            return (
              <div key={day.dayIndex} className="flex items-center gap-2 text-xs">
                <span className="w-8 text-muted-foreground">{DAY_LABELS_SHORT[day.dayIndex]}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-blue-600/70"
                    style={{ width: `${(day.spaceMinutes / busiest) * 100}%` }}
                    aria-hidden
                  />
                </div>
                <span className="w-16 text-right tabular-nums text-muted-foreground">
                  {formatHours(day.spaceMinutes)}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-2">Space-hours per day.</p>
      </section>

      {holidays.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Holidays in this week
          </h3>
          <ul className="space-y-1">
            {holidays.map((holiday) => (
              <li key={holiday.date} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{holiday.name}</span> —{" "}
                {holiday.observance === "closed"
                  ? "closed"
                  : holiday.observance === "custom_hours"
                    ? "different hours"
                    : "open as usual"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Line({
  term,
  value,
  note,
  warn,
}: {
  term: string;
  value: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className={cn("text-sm", warn ? "text-amber-800 dark:text-amber-300" : "text-foreground")}>
        {term}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </dt>
      <dd className="text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
