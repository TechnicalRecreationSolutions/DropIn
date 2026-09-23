import { Suspense } from "react";
import Link from "next/link";
import { ClipboardList, Settings2 } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { can, canReadFacility, isScoped } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { countsHref } from "@/lib/schedule/commandCentreHref";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import HeadCountTool from "@/components/conditions/HeadCountTool";
import { PageHeader } from "@/components/ui/info-tip";

/**
 * /dashboard/counts — the head-count tool (migration 061).
 *
 * The page an aux staffer lands on most, and the only writing surface they
 * have. Everything about it assumes a phone held in one hand on a wet pool
 * deck; the component carries that argument.
 *
 * **Gated on `reading:write`, never on `isReadOnly(role)`.** That function is
 * true for exactly the role this page exists for. It is the right gate for
 * schedule editing and the wrong one here, and getting it backwards would hide
 * the tool from every lifeguard while showing it to nobody who needs it.
 *
 * Opted in to instant-navigation validation, like the other dashboard pages —
 * see the note in dashboard/facilities/page.tsx for why the Suspense boundary
 * has to live inside the page rather than in the layout.
 */
export const instant = true;

interface CountsPageProps {
  searchParams: Promise<{ facility?: string }>;
}

export default function CountsPage({ searchParams }: CountsPageProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <PageHeader
          title="Head counts"
          info={
            <>
              How many people are in the building, recorded as you count them. Every entry is
              kept, so the schedule can eventually say how busy a session usually is — and if
              your facility publishes it, patrons see the latest number before they travel.
              <br />
              <br />
              Entries cannot be edited. Counted again? Record the new number; the newest one is
              what shows. Typed 400 instead of 40? Delete it.
            </>
          }
        />
      </div>

      {/* searchParams is forwarded unread — awaiting it here would pull this
          static shell into the dynamic, Suspense-gated render. */}
      <Suspense fallback={<CountsSkeleton />}>
        <Streamed className="space-y-6">
          <CountsBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function CountsBody({ searchParams }: CountsPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const supabase = await createClient();
  const { facility: facilityParam } = await searchParams;

  const { data: facilityRows } = await supabase
    .from("facilities")
    .select("id, name, city, province, is_published, photo_urls")
    .eq("org_id", orgId)
    .order("name");

  // A scoped staffer only ever sees their own buildings here. RLS would let
  // them read the others' names — facilities are readable org-wide — but
  // offering a building whose every action 403s is a worse answer than not
  // offering it.
  const visible = (facilityRows ?? []).filter((f) => canReadFacility(actor, f.id));

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
        <ClipboardList className="mx-auto mb-3 size-10 text-muted-foreground/70" />
        <h3 className="mb-1 font-medium text-foreground">No facilities assigned</h3>
        <p className="text-sm text-muted-foreground">
          {isScoped(orgContext.membership.role)
            ? "Ask a Manager to assign you a facility."
            : "Add a facility first."}
        </p>
      </div>
    );
  }

  const facility = visible.find((f) => f.id === facilityParam) ?? visible[0];

  const [{ data: spaceRows }, { data: readingRows }, { data: staffRows }] = await Promise.all([
    supabase
      .from("spaces")
      .select("id, name, capacity, display_order")
      .eq("facility_id", facility.id)
      .eq("is_published", true)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
    // The recent log only — 30 rows, not a dataset. Anything that needs totals
    // pages with `.range()`; PostgREST silently caps a response at 1,000.
    supabase
      .from("facility_readings")
      .select("*")
      .eq("facility_id", facility.id)
      .order("recorded_at", { ascending: false })
      .limit(30),
    // The email snapshot on the membership (055) is the only way to name
    // anyone — auth.users is unreadable under RLS.
    supabase
      .from("org_memberships")
      .select("user_id, display_name, email")
      .eq("org_id", orgId),
  ]);

  const recorderNames: Record<string, string> = {};
  for (const s of staffRows ?? []) {
    recorderNames[s.user_id] = s.display_name ?? s.email?.split("@")[0] ?? "a colleague";
  }

  const canWrite = can(actor, "reading:write") && canReadFacility(actor, facility.id);
  const canConfigure = can(actor, "facility:edit");

  return (
    <>
      <FacilityCardPicker
        facilities={visible}
        activeFacilityId={facility.id}
        hrefFor={countsHref}
      />

      {!facility.is_published && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          This facility is not published, so nothing recorded here reaches the public. The log
          is kept either way.
        </p>
      )}

      <HeadCountTool
        facilityId={facility.id}
        spaces={spaceRows ?? []}
        readings={readingRows ?? []}
        recorderNames={recorderNames}
        viewerId={orgContext.membership.user_id}
        canWrite={canWrite}
      />

      {canConfigure && (
        <Link
          href={`/dashboard/facilities/${facility.id}/status#public`}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="size-4 shrink-0" aria-hidden />
          Choose what patrons see from these numbers
        </Link>
      )}
    </>
  );
}

function CountsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
