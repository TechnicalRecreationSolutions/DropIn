import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertOctagon, ArrowRight, Check, Clock, Megaphone } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { canReadFacility } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import { splitStatusRows } from "@/lib/status/notices";
import { PageHeader } from "@/components/ui/info-tip";

/**
 * /dashboard/status — a stable address for "something is wrong here".
 *
 * The real page is `/dashboard/facilities/[id]/status`, which needs an id a
 * sidebar link cannot know. This resolves it: one facility in reach goes
 * straight there (the lifeguard case — one building, no choice to make), more
 * than one gets a short list with what is live at each, which doubles as the
 * org-wide status board for a manager.
 *
 * Every role reaches it. Aux staff read and report; the facility page decides
 * what each person may actually do.
 */
export const instant = true;

export default function StatusIndexPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Facility status"
        info="Closures, contamination, faults and anything else patrons need to know right now. Pick a facility to post, report or clear one."
      />
      <Suspense fallback={<StatusSkeleton />}>
        <Streamed>
          <StatusIndexBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function StatusIndexBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const supabase = await createClient();

  const [{ data: facilityRows }, { data: noticeRows }] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name")
      .eq("org_id", orgContext.org.id)
      .order("name"),
    // Open notices only — live, scheduled, draft or waiting for review. `*` so
    // the 063 review flag arrives once the column exists.
    supabase
      .from("facility_notices")
      .select("*")
      .eq("org_id", orgContext.org.id)
      .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`),
  ]);

  // Same rule as Head counts: a scoped staffer is offered only their own
  // buildings, even though RLS would let them read the others' names.
  const facilities = (facilityRows ?? []).filter((f) => canReadFacility(actor, f.id));

  if (facilities.length === 1) redirect(`/dashboard/facilities/${facilities[0].id}/status`);

  if (facilities.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        No facilities assigned. Ask a Manager to assign you one.
      </p>
    );
  }

  const now = new Date();

  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {facilities.map((f) => {
        const { live, pendingCount } = splitStatusRows(
          (noticeRows ?? []).filter((n) => n.facility_id === f.id),
          now
        );
        const worst = live[0];
        return (
          <li key={f.id}>
            <Link
              href={`/dashboard/facilities/${f.id}/status`}
              className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{f.name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {worst ? (
                    <span className="flex items-center gap-1.5 text-red-700 dark:text-red-300">
                      <AlertOctagon className="size-3.5 shrink-0" aria-hidden />
                      {worst.headline}
                      {live.length > 1 && ` +${live.length - 1} more`}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      Nothing posted
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                      <Clock className="size-3.5 shrink-0" aria-hidden />
                      {pendingCount === 1 ? "1 report waiting" : `${pendingCount} reports waiting`}
                    </span>
                  )}
                </span>
              </span>
              <Megaphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function StatusSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </div>
  );
}
