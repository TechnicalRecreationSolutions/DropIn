"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { localDateString, parseDate, sessionDateString, toSessionTime } from "@/lib/utils/dates";
import { useScheduleRange } from "@/hooks/useScheduleRange";
import { buildDeckSheet } from "@/lib/schedule/deckSheet";
import DeckSheet from "./DeckSheet";

interface DeckSheetPageProps {
  facilities: { id: string; name: string }[];
  facilityId: string;
  facilityName: string;
  /** Spaces at this facility, already in display order — they are the columns. */
  spaces: { id: string; name: string }[];
  /** YYYY-MM-DD. */
  dateKey: string;
}

/**
 * The deck sheet's controls, its data fetch, and the sheet itself.
 *
 * Scope lives in the URL (`?facility=&date=`) rather than in local
 * state, for one operational reason: "print tomorrow's sheet for the 25m pool" is
 * a link someone can bookmark or send, and a print dialog reload must not land
 * back on today.
 *
 * The day is fetched through `useScheduleRange` — the same endpoint every other
 * schedule surface reads — so the staff-only fields on this sheet (holder names,
 * setup notes) are gated by exactly one implementation of the disclosure rules
 * (migration 046). Re-deriving them here would be a second implementation free
 * to drift from the one patrons get, which was the mistake stage 2 avoided with
 * the audience toggle.
 */
export default function DeckSheetPage({
  facilities,
  facilityId,
  facilityName,
  spaces,
  dateKey,
}: DeckSheetPageProps) {
  const router = useRouter();

  // Client-only, and deliberately not derived during render on the server: a
  // print timestamp rendered server-side would hydrate against a different
  // clock, and this whole sheet only exists after a client fetch anyway.
  const [printedAt] = useState<Date | null>(() => new Date());

  const rangeStart = useMemo(() => parseDate(dateKey), [dateKey]);
  const rangeEnd = useMemo(() => {
    const next = parseDate(dateKey);
    next.setDate(next.getDate() + 1);
    return next;
  }, [dateKey]);

  const { data: sessions, isLoading, error } = useScheduleRange({
    facilityId,
    rangeStart,
    rangeEnd,
    // The sheet draws exclusive claims in lane columns and lists the drop-in
    // blocks as what is *left over*, computing that subtraction itself. Pre-cut
    // blocks would be subtracted twice and its availability line would go blank.
    subtract: "none",
  });

  const model = useMemo(
    () =>
      buildDeckSheet({
        // The range is a day wide, but a session whose occurrence lands on the
        // boundary would still arrive — the sheet is for one day, so filter on
        // the occurrence's own date rather than trusting the range.
        sessions: (sessions ?? []).filter((s) => sessionDateString(s.start) === dateKey),
        spaces,
        day: toSessionTime(parseDate(dateKey)),
      }),
    [sessions, spaces, dateKey]
  );

  function go(params: { date?: string; facility?: string }) {
    const next = new URLSearchParams();
    next.set("facility", params.facility ?? facilityId);
    next.set("date", params.date ?? dateKey);
    router.replace(`/dashboard/schedule/deck?${next.toString()}`);
  }

  function shiftDay(days: number) {
    const d = parseDate(dateKey);
    d.setDate(d.getDate() + days);
    go({ date: localDateString(d) });
  }

  const chipClass = (active: boolean) =>
    cn(
      "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
      active
        ? "bg-muted border-border text-foreground"
        : "border-border text-muted-foreground hover:text-foreground"
    );

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 print:p-0">
      {/* Everything in here is screen-only — see the print block in globals.css. */}
      <div className="no-print mb-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link
            href={`/dashboard/schedule?facility=${facilityId}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to the schedule
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftDay(-1)}
              aria-label="Previous day"
              className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={dateKey}
              onChange={(e) => e.target.value && go({ date: e.target.value })}
              aria-label="Day"
              className="px-3 py-2 border border-border rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => shiftDay(1)}
              aria-label="Next day"
              className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => go({ date: localDateString() })} className={chipClass(false)}>
              Today
            </button>
          </div>

          {facilities.length > 1 && (
            <select
              value={facilityId}
              onChange={(e) => go({ facility: e.target.value })}
              aria-label="Building"
              className="px-3 py-2 border border-border rounded-lg text-sm"
            >
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error instanceof Error ? error.message : "Could not load this day."}
          </p>
        )}
        {isLoading && <p className="text-sm text-muted-foreground">Loading the day…</p>}
      </div>

      <DeckSheet
        model={model}
        facilityName={facilityName}
        day={toSessionTime(parseDate(dateKey))}
        printedAt={printedAt}
      />
    </div>
  );
}
