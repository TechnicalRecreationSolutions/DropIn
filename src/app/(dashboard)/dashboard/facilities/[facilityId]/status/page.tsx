import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { can, canWriteNotice, ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import FacilityStatusManager from "@/components/status/FacilityStatusManager";
import PublicConditionsSettings from "@/components/conditions/PublicConditionsSettings";
import { PageHeader } from "@/components/ui/info-tip";

/**
 * /dashboard/facilities/[id]/status — what is true here right now.
 *
 * The staff half of migration 060. Not part of the facility EDIT page on
 * purpose: editing a facility is configuration, done once and revisited
 * rarely, while this is operational and is opened at 6am by whoever is on
 * shift. Burying a contamination behind a form that also holds the postal code
 * would be the wrong page for the wrong person.
 *
 * Read by every role. Written by whoever `can_write_notice()` allows —
 * including aux staff, but only when their organization has opted in. That is
 * the one permission in the app whose answer depends on a setting rather than
 * only on a role, so this page asks `canWriteNotice()` rather than `can()`.
 */

interface StatusPageProps {
  params: Promise<{ facilityId: string }>;
}

export default async function FacilityStatusPage({ params }: StatusPageProps) {
  const { facilityId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const [{ data: facility }, { data: spaces }, { data: notices }, { count: readingCount }] =
    await Promise.all([
    supabase
      .from("facilities")
      // `*` rather than a column list, for the reason widget/[orgId] gives: this
      // project applies migrations by hand, so naming public_conditions before
      // 061 lands would 500 the page instead of degrading to the default.
      .select("*")
      .eq("id", facilityId)
      .eq("org_id", orgContext.org.id)
      .maybeSingle(),
    // Ordered the way the Spaces page orders them (migration 054), so the
    // picker here reads in the same sequence as the list staff already know.
    supabase
      .from("spaces")
      .select("id, name")
      .eq("facility_id", facilityId)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("facility_notices")
      .select("*")
      .eq("facility_id", facilityId)
      .order("starts_at", { ascending: false }),
    // head:true — the settings panel only needs to know whether ANY reading
    // exists, so it can say "nothing has been recorded yet" instead of letting
    // someone publish a block that will stay empty. No rows are transferred.
    supabase
      .from("facility_readings")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId),
  ]);

  if (!facility) notFound();

  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const canWrite = canWriteNotice(
    actor,
    { auxCanPostNotices: orgContext.org.aux_can_post_notices },
    facilityId
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: "Status" },
        ]}
      />

      <div className="mb-6">
        <PageHeader
          title="Facility status"
          info={
            <>
              What is true at {facility.name} right now — a closure, a water quality problem, a
              staffing shortage. Anything posted here appears above the schedule on the public
              facility page and in every schedule embedded on your own website.
              <br />
              <br />
              This is separate from the schedule itself. Use a closure session for something
              planned weeks ahead; use a status for something that just happened.
            </>
          }
        />
      </div>

      {!facility.is_published && (
        <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          This facility is not published, so nothing posted here reaches the public yet. Staff
          still see it.
        </p>
      )}

      <FacilityStatusManager
        facilityId={facilityId}
        spaces={spaces ?? []}
        notices={notices ?? []}
        canWrite={canWrite}
        readOnlyReason={canWrite ? undefined : explainReadOnly(orgContext, facilityId)}
      />

      {/* Below the notices, and separated, because they are different jobs on
          different clocks: a notice is written in the moment and cleared the
          same day, these are set once and left. Reached directly as #public
          from the head count tool. */}
      <div className="mt-10 border-t border-border pt-8">
        <PublicConditionsSettings
          facilityId={facilityId}
          initial={{
            // `?? ` throughout: before 061 is applied these columns do not
            // exist, and the page must still render.
            publicConditions: facility.public_conditions ?? false,
            publicHeadcount: facility.public_headcount ?? "hidden",
            occupancyCapacity: facility.occupancy_capacity ?? null,
          }}
          canEdit={can(actor, "facility:edit")}
          hasReadings={(readingCount ?? 0) > 0}
        />
      </div>
    </div>
  );
}

/**
 * Why the composer is missing — in the words of the thing that has to change.
 *
 * Three distinct reasons, and the aux one is the important one: "your
 * organization has not turned this on" is actionable (ask a manager), while a
 * blank space where a button should be is a support ticket.
 */
function explainReadOnly(
  orgContext: NonNullable<Awaited<ReturnType<typeof getOrgContext>>>,
  facilityId: string
): string {
  const role = orgContext.membership.role;

  if (role === "aux" && !orgContext.org.aux_can_post_notices) {
    return (
      "Your organization has not enabled status notices for staff accounts. " +
      "A Manager can turn that on under Organization settings."
    );
  }

  if ((role === "aux" || role === "coordinator") && !orgContext.scopes.facilityIds.includes(facilityId)) {
    return "This facility is not one of yours, so you can read its status but not change it.";
  }

  return `${ROLE_LABELS[role]} accounts cannot post facility notices.`;
}
