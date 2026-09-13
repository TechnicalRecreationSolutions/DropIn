"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Calculator, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { getWeekEnd, sessionDateString, formatSessionDayFull, toSessionTime } from "@/lib/utils/dates";
import { useScheduleRange } from "@/hooks/useScheduleRange";
import {
  computeDayAvailability,
  blocksWithoutLaneDetail,
  bandTimeLabel,
  type BlockAvailability,
} from "@/lib/schedule/availability";

interface AvailabilityShadowPanelProps {
  /** The facility the open week belongs to. Deliberately NOT the schedule group — see below. */
  facilityId: string;
  weekStart: Date;
}

/**
 * Shadow mode (stage 5 of docs/PLAN-internal-view.md): what the schedule
 * *claims* beside what the bookings *say*, for the week on screen. It publishes
 * nothing and changes nothing — it exists so staff can watch the calculator
 * agree with their own hand-built numbers, on their own data, for as long as it
 * takes to believe it. Stage 6 is the separate decision to let it publish.
 *
 * **It fetches the whole facility, not the open schedule group, and that is the
 * point.** A rental almost always lives under a different schedule group than
 * the drop-in block it eats into — that separation is why the internal view
 * exists at all — so a panel scoped to the editor's own group would see no
 * rivals, compute full availability, and reassure staff with a number that was
 * never calculated from anything. It is a separate query key from the editor's,
 * which costs one extra fetch per week and makes the comparison honest.
 *
 * Quiet by design: agreement is the boring case and collapses to one line. Only
 * disagreement is worth a staff member's attention, and only they can say which
 * side is right.
 */
export default function AvailabilityShadowPanel({
  facilityId,
  weekStart,
}: AvailabilityShadowPanelProps) {
  const [open, setOpen] = useState(false);

  const { data: sessions, isLoading } = useScheduleRange({
    facilityId,
    rangeStart: weekStart,
    rangeEnd: getWeekEnd(weekStart),
  });

  const days = useMemo(() => {
    const byDay = new Map<string, BlockAvailability[]>();
    for (const session of sessions ?? []) {
      const key = sessionDateString(session.start);
      if (!byDay.has(key)) byDay.set(key, []);
    }
    for (const key of byDay.keys()) {
      const ofDay = (sessions ?? []).filter((s) => sessionDateString(s.start) === key);
      byDay.set(key, computeDayAvailability(ofDay));
    }
    return [...byDay.entries()]
      .map(([dateKey, results]) => ({ dateKey, results }))
      .filter((d) => d.results.length > 0)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [sessions]);

  const allResults = days.flatMap((d) => d.results);
  const differing = allResults.filter((r) => r.differs);
  const coarse = blocksWithoutLaneDetail(allResults);

  if (isLoading || allResults.length === 0) return null;

  return (
    <div className="border-b border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        <Calculator className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Availability check</span>
        {differing.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {allResults.length} block{allResults.length !== 1 ? "s" : ""} this week match the bookings
            entered
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5" />
            {differing.length} of {allResults.length} publish more space than the bookings leave
          </span>
        )}
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 ml-auto shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Nothing here is published. It is the same subtraction staff do by hand — what a drop-in
            block claims, minus the programs, rentals and closures booked into those same spaces —
            shown so you can check it against what you publish today.
          </p>

          {days.map((day) => (
            <div key={day.dateKey}>
              <h4 className="text-xs font-semibold text-foreground">
                {formatSessionDayFull(toSessionTime(new Date(`${day.dateKey}T00:00:00`)))}
              </h4>
              <ul className="mt-1 space-y-1.5">
                {day.results.map((result) => (
                  <li
                    key={result.sessionKey}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      result.differs ? "border-amber-200 bg-amber-50/60" : "border-border bg-card"
                    )}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{result.label}</span>
                      <span className="text-muted-foreground">
                        {bandTimeLabel(result.startMinutes, result.endMinutes)}
                      </span>
                      <span className="text-muted-foreground">
                        · publishes {result.claimed} space{result.claimed !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {result.differs ? (
                      <ul className="mt-1 space-y-0.5">
                        {result.bands.map((band) => (
                          <li key={band.startMinutes} className="text-foreground">
                            {bandTimeLabel(band.startMinutes, band.endMinutes)} —{" "}
                            <span className="font-medium">
                              {band.available} of {result.claimed}
                            </span>{" "}
                            {/* The legend counts lanes, so it only means something
                                where there are lanes to count. A block claiming one
                                space reading "1 of 1 (Reduced lanes)" is the
                                all-or-nothing case wearing a label that implies a
                                precision it does not have. */}
                            {result.claimed > 1 && (
                              <span className="text-muted-foreground">({band.label})</span>
                            )}
                            {band.takenBy.length > 0 && (
                              <span className="text-muted-foreground">
                                {" "}
                                · rest held by {band.takenBy.join(", ")}
                              </span>
                            )}
                          </li>
                        ))}
                        {result.suppressed.map((gap) => (
                          <li key={gap.startMinutes} className="text-amber-800">
                            {bandTimeLabel(gap.startMinutes, gap.endMinutes)} — nothing left; this
                            block has no space at all then
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-0.5 text-muted-foreground">
                        Every space it claims is free for the whole block.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* The calculator's resolution is a space row, so a pool modelled as one
              space can only ever be "all" or "nothing". Saying so is more useful
              than rendering a confident "1 lane available". */}
          {coarse.length > 0 && (
            <p className="text-xs text-muted-foreground border-t border-border pt-2">
              {coarse.length} block{coarse.length !== 1 ? "s" : ""} claim a single space, so this can
              only say all-or-nothing for {coarse.length !== 1 ? "them" : "it"}. Lane counts need
              lanes to exist as spaces.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
