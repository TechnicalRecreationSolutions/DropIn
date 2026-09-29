import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight, Clock, Info, Megaphone } from "lucide-react";
import type { StatusShortcutNotice } from "@/lib/status/notices";
import { bannerVariants } from "@/components/ui/banner";
import { cn } from "@/lib/utils/cn";

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
            className={cn(
              bannerVariants({ variant: n.severity === "closure" ? "error" : "warning" }),
              "group items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-semibold group-hover:underline">{n.headline}</span>
            <span className="shrink-0 text-label">Posted</span>
          </Link>
        );
      })}

      {pendingCount > 0 && (
        <Link
          href={href}
          className={cn(
            bannerVariants({ variant: "warning" }),
            "group items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <Clock className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 font-semibold group-hover:underline">
            {pendingCount === 1 ? "1 report is" : `${pendingCount} reports are`} waiting for approval
          </span>
          <ArrowRight className="size-4 shrink-0" aria-hidden />
        </Link>
      )}

      <Link
        href={href}
        className="flex min-h-11 items-center gap-3 rounded-banner border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Megaphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">{ACTION_LABEL[mode]}</span>
        {mode !== "view" && (
          <span className="hidden text-caption text-muted-foreground sm:inline">
            Closure, contamination, fault…
          </span>
        )}
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </div>
  );
}
