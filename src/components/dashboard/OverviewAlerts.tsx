import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, Clock, FileEdit } from "lucide-react";
import type { NoticeSeverity } from "@/types/app.types";
import { bannerVariants } from "@/components/ui/banner";
import { cn } from "@/lib/utils/cn";

// A banner that is also a link: one element, so the whole row is the target.
function alertRowClass(variant: "warning" | "error") {
  return cn(
    bannerVariants({ variant }),
    "group transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  );
}

/** One live facility notice, already phrased — see `summary`. */
export interface OverviewNotice {
  id: string;
  severity: NoticeSeverity;
  /** "Pool closed — contamination · Lane pool". Built by the page. */
  summary: string;
}

/** A staff report waiting for approval (migration 063). Org-wide, so it carries its own link. */
export interface OverviewReport extends OverviewNotice {
  href: string;
}

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
  /**
   * Facility notices the public can see right now (migration 060), worst
   * first. These come FIRST in the list below and are the only alert here that
   * is already visible to patrons — everything else is a task, this is a
   * broadcast, and someone arriving at the Overview needs to know one is live
   * before they read anything else.
   */
  notices?: readonly OverviewNotice[];
  /**
   * Staff reports this viewer may publish. Above even the live notices: a live
   * notice is already doing its job, a report is a closure nobody has told
   * patrons about yet.
   */
  reports?: readonly OverviewReport[];
  /** Where a notice row links. Absent only when there is no facility in scope. */
  statusHref?: string;
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
export default function OverviewAlerts({
  conflictCount,
  conflictSummary,
  draftCount,
  notices = [],
  reports = [],
  statusHref,
}: OverviewAlertsProps) {
  if (conflictCount === 0 && draftCount === 0 && notices.length === 0 && reports.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        Nothing posted, no conflicts, and every schedule here is published.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {reports.map((report) => (
        <Link
          key={report.id}
          href={report.href}
          className={alertRowClass("error")}
        >
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-semibold group-hover:underline">{report.summary}</span>
            <span className="block">
              Reported by staff. Patrons can&apos;t see it until you publish it.
            </span>
          </span>
          <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden />
        </Link>
      ))}

      {notices.map((notice) => (
        <Link
          key={notice.id}
          href={statusHref ?? "/dashboard/facilities"}
          className={alertRowClass(notice.severity === "closure" ? "error" : "warning")}
        >
          {notice.severity === "closure" ? (
            <AlertOctagon className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="font-semibold group-hover:underline">{notice.summary}</span>
            <span className="block">Patrons can see this now.</span>
          </span>
          <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden />
        </Link>
      ))}

      {conflictCount > 0 && (
        <Link
          href="/dashboard/conflicts"
          className={alertRowClass("warning")}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-semibold group-hover:underline">
              {conflictCount === 1 ? "A double-booking needs a decision" : `${conflictCount} double-bookings need a decision`}
            </span>
            {conflictSummary && (
              <span className="block truncate">{conflictSummary}</span>
            )}
          </span>
          <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden />
        </Link>
      )}

      {draftCount > 0 && (
        <p className="flex items-start gap-3 px-4 text-body text-muted-foreground">
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
