"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  getWeekEnd,
  sessionDateString,
  formatSessionDayFull,
  formatSessionTime,
  toSessionTime,
} from "@/lib/utils/dates";
import { useScheduleRange } from "@/hooks/useScheduleRange";
import {
  disclosureSummary,
  isExclusiveKind,
  occupancyKindLabel,
  sessionDisplayLabel,
  type OccupancyKind,
} from "@/lib/sessions/occupancy";
import type { ExpandedSession } from "@/types/schedule.types";

interface StaffClaimsPanelProps {
  /** The facility the open week belongs to. Deliberately NOT the schedule group — see below. */
  facilityId: string;
  weekStart: Date;
}

/**
 * Everything holding space at this facility this week — programs, rentals and
 * closures — in one staff-only list, with who holds it and what has to be set up.
 *
 * This slot used to hold the availability shadow panel (stage 5), which compared
 * what a drop-in block *published* against what the bookings left it. Residual
 * subtraction answers that question by construction now — the schedule does the
 * subtraction when it renders, so a block can no longer publish space it does not
 * have, and a panel asking whether it does would only ever say no. What staff
 * still cannot get anywhere else is the other half: a single place to see what is
 * booked, who has it, and what it needs.
 *
 * **It fetches the whole facility, not the open schedule group, and that is the
 * point** — inherited from the panel it replaces, for the same reason. A rental
 * almost always lives under a different schedule group than the drop-in block it
 * eats into; that separation is why the internal view exists at all. Scoped to
 * the editor's own group this would quietly omit the bookings staff most need to
 * see.
 *
 * Everything here is staff-only by construction rather than by filtering:
 * `holderName` and `setupNotes` come from `session_internal`, which has no
 * public-read policy, and names are rendered through `sessionDisplayLabel` so a
 * withheld booking cannot be leaked by a later edit. `internal` occurrences reach
 * this panel for the same reason they reach the rest of the dashboard — the
 * caller is a member of the org that owns them.
 */
export default function StaffClaimsPanel({ facilityId, weekStart }: StaffClaimsPanelProps) {
  const [open, setOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<OccupancyKind | null>(null);

  const { data: sessions, isLoading } = useScheduleRange({
    facilityId,
    rangeStart: weekStart,
    rangeEnd: getWeekEnd(weekStart),
  });

  const claims = useMemo(
    () =>
      (sessions ?? [])
        .filter((s) => isExclusiveKind(s.occupancyKind))
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [sessions]
  );

  // Counted by kind rather than totalled, because the collapsed line is the bit
  // most staff will ever read: "2 rentals" is worth opening for, "9 bookings" is
  // not. Counts are of the whole week, never of the filtered view — a chip whose
  // number moved when you pressed it could not be used to compare weeks.
  const counts = useMemo(() => {
    const byKind = new Map<OccupancyKind, number>();
    for (const claim of claims) {
      byKind.set(claim.occupancyKind, (byKind.get(claim.occupancyKind) ?? 0) + 1);
    }
    return [...byKind.entries()].map(([kind, count]) => ({ kind, count }));
  }, [claims]);

  // A filter for a kind this week does not have would strand the panel empty
  // with no obvious way back, so a stale one falls back to showing everything
  // rather than being cleared by an effect on every week change.
  const activeKind = counts.some((c) => c.kind === kindFilter) ? kindFilter : null;

  const days = useMemo(() => {
    const byDay = new Map<string, ExpandedSession[]>();
    for (const claim of claims) {
      if (activeKind && claim.occupancyKind !== activeKind) continue;
      const key = sessionDateString(claim.start);
      byDay.set(key, [...(byDay.get(key) ?? []), claim]);
    }
    return [...byDay.entries()]
      .map(([dateKey, items]) => ({ dateKey, items }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [claims, activeKind]);

  const noteCount = claims.filter((c) => !!c.setupNotes?.trim()).length;

  if (isLoading) return null;

  return (
    <div className="border-b border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        <ClipboardList className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Booked space</span>
        <span className="text-xs text-muted-foreground">
          {claims.length === 0
            ? "Nothing holds space this week"
            : counts
                .map(({ kind, count }) => `${count} ${occupancyKindLabel(kind).toLowerCase()}`)
                .join(" · ")}
          {noteCount > 0 && ` · ${noteCount} with setup notes`}
        </span>
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
            Every program, rental and closure at this building this week, including schedules other
            than the one you have open. Drop-in blocks are not listed — they take whatever these
            leave.
          </p>

          {/* Only the kinds this week actually has. A "Rental or club" chip on a
              week with no rentals is a control that can only ever empty the list. */}
          {counts.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setKindFilter(null)}
                aria-pressed={!activeKind}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                  !activeKind
                    ? "bg-muted border-border text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                All {claims.length}
              </button>
              {counts.map(({ kind, count }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setKindFilter(kind)}
                  aria-pressed={activeKind === kind}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                    activeKind === kind
                      ? "bg-muted border-border text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {occupancyKindLabel(kind)} {count}
                </button>
              ))}
            </div>
          )}

          {days.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">
              No programs, rentals or closures are booked at this building this week.
            </p>
          ) : (
            days.map((day) => (
              <div key={day.dateKey}>
                <h4 className="text-xs font-semibold text-foreground">
                  {formatSessionDayFull(toSessionTime(new Date(`${day.dateKey}T00:00:00`)))}
                </h4>
                <ul className="mt-1 space-y-1.5">
                  {day.items.map((claim) => (
                    <li
                      key={claim.key}
                      className="rounded-lg border border-border bg-card px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">
                          {sessionDisplayLabel(claim)}
                        </span>
                        <span
                          className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          style={
                            claim.templateColor
                              ? {
                                  borderColor: `color-mix(in srgb, ${claim.templateColor} 45%, transparent)`,
                                }
                              : undefined
                          }
                        >
                          {occupancyKindLabel(claim.occupancyKind)}
                        </span>
                        <span className="text-muted-foreground">
                          {formatSessionTime(claim.start)}–{formatSessionTime(claim.end)}
                        </span>
                      </div>

                      <p className="mt-0.5 text-muted-foreground">
                        {claim.spaceNames.length > 0
                          ? claim.spaceNames.join(", ")
                          : "No space recorded — this one cannot take anything away from a drop-in block"}
                        {" · "}
                        {claim.scheduleGroupName}
                        {" · "}
                        {disclosureSummary(claim.disclosure)}
                      </p>

                      {/* The reason a guard opens this panel at all: what has to be
                          in the water before the booking starts. */}
                      {claim.setupNotes?.trim() && (
                        <p className="mt-1 rounded-md bg-muted px-2 py-1 text-foreground">
                          {claim.setupNotes.trim()}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
