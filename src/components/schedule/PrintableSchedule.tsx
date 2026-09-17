"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Printer } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatSessionTime } from "@/lib/utils/dates";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { sessionDayIndex } from "@/lib/schedule/weekGeometry";
import {
  describeActiveFilters,
  type SessionFilterState,
} from "@/lib/schedule/sessionFilters";
import { cn } from "@/lib/utils/cn";

interface PrintableScheduleProps {
  /** Heading on the sheet — the widget's title, or the facility name. */
  title: string;
  /** Org, facility or switcher entry — whatever says *whose* schedule this is. */
  subtitle?: string | null;
  weekStart: Date;
  /** The week *after* the visitor's filters — exactly what they were looking at. */
  sessions: ExpandedSession[];
  /** How many the week had before filtering, for the "N of M" line. */
  totalCount: number;
  filters: SessionFilterState;
  /**
   * The schedule the visitor picked in a multi-schedule switcher, if any. Not a
   * filter in `filters`' sense, but it is still a narrowing a reader of the
   * printout can't see, so the disclaimer names it.
   */
  scopeLabel?: string | null;
}

/**
 * The paper version of a public schedule: every day of the week in view, as a
 * plain time/session/where table, followed by nothing interactive at all.
 *
 * Rendered alongside the live schedule but only visible in print (`hidden
 * print:block`); the caller hides its own interactive UI with `print:hidden`.
 * It is one layout for every view rather than a print stylesheet over each of
 * them, because the views are built for a screen — the grid and list collapse to
 * one day on a phone, the list folds away days already past, the map shows one
 * day at a time — and any of those printed as-is silently drops sessions.
 *
 * It takes the *filtered* sessions, so what prints is what the visitor chose;
 * the notice at the top says so, because a sheet on a fridge door that quietly
 * omits half the week reads as "that's everything".
 */
export default function PrintableSchedule({
  title,
  subtitle,
  weekStart,
  sessions,
  totalCount,
  filters,
  scopeLabel,
}: PrintableScheduleProps) {
  // Set on the client only: a server-rendered timestamp would hydrate against a
  // different minute (same reason as DeckSheetPage).
  const [printedAt] = useState(() => new Date());

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        return date;
      }),
    [weekStart]
  );

  const byDay = useMemo(() => {
    const map: ExpandedSession[][] = Array.from({ length: 7 }, () => []);
    for (const session of sessions) map[sessionDayIndex(session.start)].push(session);
    for (const list of map) list.sort((a, b) => a.start.getTime() - b.start.getTime());
    return map;
  }, [sessions]);

  const filterParts = describeActiveFilters(filters);
  const filtered = filterParts.length > 0;
  const weekEnd = days[6];

  return (
    <div className="printable-schedule hidden print:block text-black bg-white">
      <header className="mb-3">
        {subtitle && <p className="text-[9pt] text-gray-600">{subtitle}</p>}
        <h1 className="text-[16pt] font-bold leading-tight">{title}</h1>
        <p className="text-[10pt] font-medium">
          Week of {format(weekStart, "EEEE, MMMM d")} – {format(weekEnd, "EEEE, MMMM d, yyyy")}
        </p>
      </header>

      <div className="printable-notice mb-4 border border-gray-400 rounded px-3 py-2 text-[9pt] leading-snug">
        <p>
          <strong>Schedule subject to change.</strong> Sessions can be cancelled, moved or
          added after this was printed — please check the online schedule before you go.
          Printed {format(printedAt, "MMMM d, yyyy 'at' h:mm a")}.
        </p>
        {(filtered || scopeLabel) && (
          <p className="mt-1.5">
            <strong>This is a filtered view — some sessions are not shown.</strong>{" "}
            {scopeLabel && <>Schedule: {scopeLabel}. </>}
            {filtered && (
              <>
                Only sessions matching {filterParts.join(" · ")} are listed
                {` (${sessions.length} of ${totalCount} this week)`}.
              </>
            )}
          </p>
        )}
      </div>

      {days.map((day, i) => {
        const list = byDay[i];
        // Under a day filter, the other days are empty by design — printing six
        // "nothing on" headings is noise. Without one, an empty day is real
        // information ("closed Sunday") and stays.
        if (list.length === 0 && filtered) return null;
        return (
          <section key={i} className="printable-day mb-3">
            <h2 className="text-[11pt] font-bold border-b-2 border-black pb-0.5 mb-1">
              {format(day, "EEEE, MMMM d")}
            </h2>
            {list.length === 0 ? (
              <p className="text-[9pt] text-gray-600 py-1">No drop-in sessions.</p>
            ) : (
              // Fixed widths so the columns line up from one day to the next —
              // each day is its own table, and auto layout sizes each separately.
              <table className="w-full table-fixed text-[9pt] border-collapse">
                <colgroup>
                  <col className="w-[22%]" />
                  <col className="w-[36%]" />
                  <col className="w-[24%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <tbody>
                  {list.map((session) => {
                    const where = [session.spaceNames.join(", "), session.locationDetail]
                      .filter(Boolean)
                      .join(" · ");
                    const notes = [session.ageGroup, session.skillLevel, session.modificationNote]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr key={session.key} className="border-b border-gray-300 align-top">
                        <td className="py-1 pr-3 font-medium">
                          {formatSessionTime(session.start)} – {formatSessionTime(session.end)}
                        </td>
                        <td className="py-1 pr-3 font-semibold">
                          {sessionDisplayLabel(session)}
                          {session.isModified && (
                            <span className="ml-1 font-normal italic">(changed)</span>
                          )}
                        </td>
                        <td className="py-1 pr-3">{where}</td>
                        <td className="py-1 text-gray-700">{notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The visitor's Print button. `onTint` for the coloured header bar, where the
 * view pills also sit on the org colour.
 */
export function PrintScheduleButton({
  onTint = false,
  className,
}: {
  onTint?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn(
        "print:hidden inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
        onTint ? "text-white/90 hover:text-white" : "text-gray-700 hover:bg-gray-100",
        className
      )}
      style={onTint ? { backgroundColor: "rgba(255,255,255,.18)" } : undefined}
      aria-label="Print this schedule"
    >
      <Printer className="w-3.5 h-3.5" />
      Print
    </button>
  );
}
