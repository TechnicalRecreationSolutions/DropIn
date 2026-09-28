import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight, Clock, Info, Megaphone } from "lucide-react";
import type { StatusShortcutNotice } from "@/lib/status/notices";

export type { StatusShortcutNotice };

/**
 * The way into facility status from the pages staff actually have open.
 *
 * The status page (migration 060) was only linked from the Overview, which aux
 * staff are redirected away from, and from the Facilities grid, which is not in
 * their navigation — so the lifeguard who found the contamination had no path
 * to the one tool built for that moment. This strip sits on Head counts and on
 * the schedule, the two places a staffer already is when something goes wrong.
 *
 * It does two jobs at once, on purpose:
 *
 *   - **Tells them what is already posted.** A guard about to report a
 *     closure should see that a colleague already did.
 *   - **Offers the action in the words of what they can do.** "Post a status"
 *     for someone who can publish, "Report a problem" for a staffer whose
 *     report goes to a Manager (migration 063), "Facility status" for anyone
 *     who can only read.
 *
 * Server-renderable; the caller decides the mode with `canWriteNotice` /
 * `canReportNotice` from `lib/auth/roles.ts`.
 */
export interface StatusShortcutProps {
  facilityId: string;
  /** Live, published notices for this facility, worst first. */
  live: readonly StatusShortcutNotice[];
  /** Staff reports waiting for approval at this facility (063). */
  pendingCount: number;
  mode: "post" | "report" | "view";
}

const ACTION_LABEL: Record<StatusShortcutProps["mode"], string> = {
  post: "Post a status",
  report: "Report a problem",
  view: "Facility status",
};

export default function StatusShortcut({ facilityId, live, pendingCount, mode }: StatusShortcutProps) {
  const href = `/dashboard/facilities/${facilityId}/status`;

  return (
    <div className="space-y-2">
      {live.map((n) => {
        const Icon = n.severity === "closure" ? AlertOctagon : n.severity === "caution" ? AlertTriangle : Info;
        return (
          <Link
            key={n.id}
            href={href}
            className={
              n.severity === "closure"
                ? "flex items-center gap-2.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:hover:bg-red-500/15"
                : "flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
            }
          >
            <Icon
              className={`size-4 shrink-0 ${
                n.severity === "closure" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
              }`}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{n.headline}</span>
            <span className="shrink-0 text-xs text-muted-foreground">Posted</span>
          </Link>
        );
      })}

      {pendingCount > 0 && (
        <Link
          href={href}
          className="flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
        >
          <Clock className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span className="min-w-0 flex-1 font-medium text-foreground">
            {pendingCount === 1 ? "1 report is" : `${pendingCount} reports are`} waiting for approval
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      )}

      <Link
        href={href}
        className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
      >
        <Megaphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">{ACTION_LABEL[mode]}</span>
        {mode !== "view" && (
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
            Closure, contamination, fault…
          </span>
        )}
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </div>
  );
}
