import { Suspense } from "react";
import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import {
  can,
  canReadFacility,
  canReportNotice,
  canWriteNotice,
  isReadOnly,
  isScoped,
  ROLE_LABELS,
} from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import FacilityStatusManager from "@/components/status/FacilityStatusManager";
import { loadStatusTemplates } from "@/lib/status/load-templates";
import PublicConditionsSettings from "@/components/conditions/PublicConditionsSettings";
import { InfoTip, PageHeader } from "@/components/ui/info-tip";
import HeadCountTool from "@/components/conditions/HeadCountTool";
import { Banner } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/skeleton";

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

export default function FacilityStatusPage({ params }: StatusPageProps) {
  // The body reads the session and the database, so it streams behind a
  // boundary; without one Next reports "uncached data during prerendering"
  // on every navigation here (logged by design-shots before this rework).
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-3xl rounded-card" aria-busy="true" />}>
      <StatusBody params={params} />
    </Suspense>
  );
}

async function StatusBody({ params }: StatusPageProps) {
  const { facilityId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const [
    { data: facility },
    { data: spaces },
    { data: notices },
    { data: readings },
    { data: members },
    { data: departments },
    { templates, fromLibrary },
  ] = await Promise.all([
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
      .select("id, name, department_id, capacity, is_published")
      .eq("facility_id", facilityId)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("facility_notices")
      .select("*")
      .eq("facility_id", facilityId)
      .order("starts_at", { ascending: false }),
    // The People here counter's recent log (migration 061) — 30 rows, not a
    // dataset; anything needing totals pages with `.range()`. Also answers
    // the settings panel's "has anything been recorded?".
    supabase
      .from("facility_readings")
      .select("*")
      .eq("facility_id", facilityId)
      .order("recorded_at", { ascending: false })
      .limit(30),
    // "Reported by …" on a waiting report and "who" on a count. auth.users is
    // unreadable under RLS, so this is the snapshot org_memberships keeps.
    supabase
      .from("org_memberships")
      .select("user_id, email, display_name")
      .eq("org_id", orgContext.org.id),
    // One row each on the status board, in the order the Departments page uses.
    supabase
      .from("departments")
      .select("id, name")
      .eq("facility_id", facilityId)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
    // The organization's status library (migration 064), or the built-in
    // catalogue when 064 is not applied yet.
    loadStatusTemplates(supabase, orgContext.org.id),
  ]);

  if (!facility) notFound();

  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const canWrite = canWriteNotice(
    actor,
    { auxCanPostNotices: orgContext.org.aux_can_post_notices },
    facilityId
  );
  const canReport = !canWrite && canReportNotice(actor, facilityId);
  const canEditFacility = can(actor, "facility:edit");
  // Counting is `reading:write`, never `!isReadOnly(role)` — that is true
  // for exactly the lifeguards this tool is mostly for.
  const canCount = can(actor, "reading:write") && canReadFacility(actor, facilityId);
  const recorderNames = Object.fromEntries(
    (members ?? []).map((m) => [m.user_id, m.display_name ?? m.email?.split("@")[0] ?? "a colleague"])
  );
  const reporters = Object.fromEntries(
    (members ?? []).filter((m) => m.email).map((m) => [m.user_id, m.email as string])
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb
        items={[
          // Read-only staff have no Facilities page — it is a management grid.
          ...(isReadOnly(orgContext.membership.role)
            ? []
            : [{ label: "Facilities", href: "/dashboard/facilities" }]),
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: "Status" },
        ]}
      />

      <div className="mb-6">
        <PageHeader
          title="Facility status"
          info={
            <>
              What is true at {facility.name} right now: what is posted, one row per
              department, and how many people are here. Anything posted appears above the schedule on the public facility page and in every
              embedded schedule. Use a closure session for something planned weeks ahead; use a
              status for something that just happened.
            </>
          }
        />
      </div>

      {!facility.is_published && (
        <Banner variant="warning" role={undefined} className="mb-6">
          This facility is not published, so nothing posted here reaches the public yet. Staff
          still see it.
        </Banner>
      )}

      <FacilityStatusManager
        facilityId={facilityId}
        departments={departments ?? []}
        spaces={spaces ?? []}
        notices={notices ?? []}
        templates={templates}
        canManageLibrary={can(actor, "notice-template:manage") && fromLibrary}
        departmentColumn={fromLibrary}
        canWrite={canWrite}
        canReport={canReport}
        reporters={reporters}
        readOnlyReason={canWrite || canReport ? undefined : explainReadOnly(orgContext, facilityId)}
        afterBoard={
          <section id="people" className="scroll-mt-20">
            <div className="mb-3 flex items-center gap-1.5">
              <h2 className="text-heading text-foreground">People here</h2>
              <InfoTip label="About counts">
                How many people are in the building, logged as you count them. The newest
                count is what shows; to correct one, count again. Typed 400 instead of 40?
                Delete it from Recent entries. Every entry is kept for Analytics.
              </InfoTip>
            </div>
            <HeadCountTool
              facilityId={facilityId}
              spaces={(spaces ?? []).filter((s) => s.is_published)}
              readings={readings ?? []}
              recorderNames={recorderNames}
              viewerId={orgContext.membership.user_id}
              canWrite={canCount}
              // The 061 delete policy: your own entries, or anyone's for an
              // owner or manager.
              canManage={!isScoped(orgContext.membership.role)}
            />
          </section>
        }
      />

      {/* Below the notices, and separated, because they are different jobs on
          different clocks: a notice is written in the moment and cleared the
          same day, these are set once and left. Opened directly by #public. Configuration rather than an operational
          tool, so shown only to people who can change it — staff used to get
          it as a greyed-out form. */}
      {canEditFacility && (
      <div className="mt-10 border-t border-border pt-6">
        <PublicConditionsSettings
          facilityId={facilityId}
          initial={{
            // `?? ` throughout: before 061 is applied these columns do not
            // exist, and the page must still render.
            publicConditions: facility.public_conditions ?? false,
            publicHeadcount: facility.public_headcount ?? "hidden",
            occupancyCapacity: facility.occupancy_capacity ?? null,
          }}
          canEdit={canEditFacility}
          hasReadings={(readings ?? []).length > 0}
        />
      </div>
      )}
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
      "A Manager can turn that on under Settings › Permissions."
    );
  }

  if ((role === "aux" || role === "coordinator") && !orgContext.scopes.facilityIds.includes(facilityId)) {
    return "This facility is not one of yours, so you can read its status but not change it.";
  }

  return `${ROLE_LABELS[role]} accounts cannot post facility notices.`;
}
