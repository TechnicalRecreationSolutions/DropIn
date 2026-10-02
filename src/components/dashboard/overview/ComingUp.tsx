import Link from "next/link";
import { CalendarRange, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RunoutWarning, WeekReadiness } from "@/lib/dashboard/overview";
import { inDays, shortDay } from "@/lib/dashboard/overview";

/**
 * "Coming up": is each upcoming week ready to go public, department by
 * department (each coordinator approves their own slice, migration 037), and
 * is anything about to run out with nothing lined up behind it.
 */
export default function ComingUp({
  weeks,
  runouts,
  reviewHref,
  newScheduleHref,
}: {
  weeks: WeekReadiness[];
  runouts: (RunoutWarning & { departmentName: string | null })[];
  /** Command centre link for a department and week. */
  reviewHref: (departmentId: string | null, weekStart: string) => string;
  newScheduleHref: string | null;
}) {
  const hasWeeks = weeks.some((w) => w.departments.length > 0);
  if (!hasWeeks && runouts.length === 0) return null;

  return (
    <section aria-labelledby="coming-up-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="coming-up-heading" className="text-heading text-foreground">
          Coming up
        </h2>
        <span className="text-caption text-muted-foreground">
          Patrons only see a week once its department approves it
        </span>
      </div>

      {hasWeeks && (
        <ul className="rounded-card border border-border bg-card shadow-card">
          {weeks.map((w) => {
            const firstOpen = w.departments.find((d) => d.status !== "approved" || d.conflictCount > 0);
            return (
              <li
                key={w.weekStart}
                className="grid grid-cols-1 items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[120px_minmax(0,1fr)_auto]"
              >
                <div>
                  <p className="text-body font-semibold text-foreground tabular-nums">{w.label}</p>
                  <p className="text-caption text-muted-foreground">{w.relative}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {w.departments.length === 0 && (
                    <span className="text-caption text-muted-foreground">Nothing published this week</span>
                  )}
                  {w.departments.map((d) => {
                    const conflicts = d.conflictCount > 0 ? `, ${d.conflictCount} conflict${d.conflictCount === 1 ? "" : "s"}` : "";
                    if (d.status === "approved" && d.conflictCount === 0) {
                      return (
                        <Badge key={d.departmentId ?? "none"} variant="success">
                          <Check aria-hidden />
                          {d.departmentName}
                        </Badge>
                      );
                    }
                    return (
                      <Badge
                        key={d.departmentId ?? "none"}
                        variant={d.status === "pending" && !conflicts ? "default" : "warning"}
                      >
                        {d.departmentName} ·{" "}
                        {d.status === "approved" ? "approved" : d.status === "needs_changes" ? "needs changes" : "not reviewed"}
                        {conflicts}
                      </Badge>
                    );
                  })}
                </div>
                <div>
                  {firstOpen && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={reviewHref(firstOpen.departmentId, w.weekStart)}>Review</Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {runouts.map((r) => (
        <div
          key={r.scheduleGroupId}
          className="mt-3 flex flex-wrap items-center gap-3 rounded-card border border-border bg-card px-4 py-3.5 shadow-card"
        >
          <CalendarRange aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-body text-foreground">
            <span className="font-semibold">
              {r.departmentName ? `${r.departmentName}: ` : ""}
              {r.name} ends {shortDay(r.endsOn)}.
            </span>{" "}
            <span className="text-muted-foreground">
              Nothing is set up after it, so the widget goes empty {inDays(r.daysLeft + 1)}.
            </span>
          </p>
          {newScheduleHref && (
            <Button asChild variant="outline" size="sm">
              <Link href={newScheduleHref}>Set up the next one</Link>
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
