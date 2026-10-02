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
  ROLE_LABELS,
} from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import FacilityStatusSimple from "@/components/status/simple/FacilityStatusSimple";
import { loadStatusTemplates } from "@/lib/status/load-templates";
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
 * Operational only. What patrons are shown (occupancy, temperatures) is set
 * on the facility's Edit page, and the history and totals live in Analytics:
 * the user's call (2026-10-01) was that this page holds neither settings nor
 * analytics.
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
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-6xl rounded-card" aria-busy="true" />}>
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
    // The newest readings (migration 061), for the counter's "Last count" and
    // the settings panel's "has anything been recorded?". The full log lives
    // in Analytics › Attendance, which pages with `.range()`.
    supabase
      .from("facility_readings")
      .select("*")
      .eq("facility_id", facilityId)
      .order("recorded_at", { ascending: false })
      .limit(30),
    // "Reported by …" on a waiting report. auth.users is
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
  // Counting is `reading:write`, never `!isReadOnly(role)` — that is true
  // for exactly the lifeguards this tool is mostly for.
  const canCount = can(actor, "reading:write") && canReadFacility(actor, facilityId);
  const reporters = Object.fromEntries(
    (members ?? []).filter((m) => m.email).map((m) => [m.user_id, m.email as string])
  );

  return (
    <div className="mx-auto max-w-xl">
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

      {!facility.is_published && (
        <Banner variant="warning" role={undefined} className="mb-6">
          This facility is not published, so nothing posted here reaches the public yet. Staff
          still see it.
        </Banner>
      )}

      {/* One narrow column, phone and laptop alike (design: "Facility status:
          simple", 2026-10-01). FacilityStatusManager and HeadCountTool are the
          fuller versions this replaced; they are no longer rendered here. */}
      <FacilityStatusSimple
        facilityName={facility.name}
        board={{
          facilityId,
          departments: departments ?? [],
          spaces: spaces ?? [],
          notices: notices ?? [],
          templates,
          canManageLibrary: can(actor, "notice-template:manage") && fromLibrary,
          departmentColumn: fromLibrary,
          canWrite,
          canReport,
          reporters,
          readOnlyReason: canWrite || canReport ? undefined : explainReadOnly(orgContext, facilityId),
        }}
        people={{
          orgId: orgContext.org.id,
          facilityId,
          spaces: spaces ?? [],
          readings: readings ?? [],
          canWrite: canCount,
        }}
      />
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
