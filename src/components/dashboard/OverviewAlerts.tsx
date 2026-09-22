import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, FileEdit } from "lucide-react";

export interface OverviewAlertsProps {
  /** Unresolved double-bookings in the current facility/department/schedule scope. */
  conflictCount: number;
  /**
   * The first one, already phrased — "Lap Swim × Public Swim in Lane 1".
   *
   * Built by the page rather than here because naming it needs the conflict
   * row, and a component that took the row would have to know the shape of
   * `OrgConflict` to say one sentence.
   */
  conflictSummary: string | null;
  /** Schedules in scope that are still drafts, i.e. invisible to patrons. */
  draftCount: number;
}

/**
 * The "does anything need me?" line, directly under the header.
 *
 * Two rules it exists to enforce:
 *
 *   1. **A problem names itself.** "Conflicts: 1" is an errand — you have to go
 *      somewhere else to find out what it is. "Lap Swim × Public Swim in Lane 1"
 *      is a task you can already think about.
 *   2. **All-clear is a result.** When nothing is wrong this still renders, as
 *      one quiet line. Silence would be indistinguishable from the page not
 *      having checked, and the single most common reason to open the Overview
 *      is to be told there is nothing to do.
 */
export default function OverviewAlerts({ conflictCount, conflictSummary, draftCount }: OverviewAlertsProps) {
  if (conflictCount === 0 && draftCount === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        No conflicts, and every schedule here is published.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {conflictCount > 0 && (
        <Link
          href="/dashboard/conflicts"
          className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-foreground">
              {conflictCount === 1 ? "A double-booking needs a decision" : `${conflictCount} double-bookings need a decision`}
            </span>
            {conflictSummary && (
              <span className="block truncate text-muted-foreground">{conflictSummary}</span>
            )}
          </span>
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      )}

      {draftCount > 0 && (
        <p className="flex items-start gap-2.5 px-3 text-sm text-muted-foreground">
          <FileEdit className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground">
              {draftCount === 1 ? "1 schedule is still a draft" : `${draftCount} schedules are still drafts`}
            </span>{" "}
            &mdash; patrons cannot see {draftCount === 1 ? "it" : "them"} yet. {draftCount === 1 ? "It is" : "They are"} in the
            list below.
          </span>
        </p>
      )}
    </div>
  );
}
