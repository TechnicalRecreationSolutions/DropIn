import { redirect } from "next/navigation";
import { Suspense } from "react";
import { occupancyKindLabel } from "@/lib/sessions/occupancy";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { isReadOnly } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { NO_DEPARTMENT, sessionsHref } from "@/lib/schedule/commandCentreHref";
import { Skeleton } from "@/components/ui/skeleton";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import DepartmentPicker from "@/components/department/DepartmentPicker";
import DeleteSessionTemplateButton from "@/components/session-template/DeleteSessionTemplateButton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import Streamed from "@/components/ui/streamed";
import { PageHeader } from "@/components/ui/info-tip";

interface SessionsPageProps {
  searchParams: Promise<{ facility?: string; department?: string }>;
}

type DepartmentRow = { id: string; name: string; facility_id: string };

type SessionTemplateRow = {
  id: string;
  name: string;
  color: string | null;
  default_duration_minutes: number;
  occupancy_kind: "drop_in" | "program" | "rental" | "closure";
  disclosure: "public" | "reserved" | "internal";
  facility_id: string;
  department_id: string | null;
  session_template_spaces: { spaces: { name: string } }[];
};

/**
 * The dedicated Session templates page — reusable, color-coded activity
 * definitions, scoped to one department at a time (or the whole facility —
 * see session_templates.department_id, migration 042). Two schedules in the
 * same department (e.g. Spring Swim and Fall Swim under Aquatics) reuse the
 * exact same template list; a facility-wide template (no department) is
 * available to every schedule in the building. Used to live nested under
 * facilities/[facilityId]/schedule-groups/[scheduleGroupId]/session-templates;
 * now it's its own route, matching Spaces and Map, and is where the command
 * centre's template rail "Manage" link and the sidebar's Sessions item both
 * point.
 *
 * Opted in to instant-navigation validation: Next.js re-renders this route in
 * dev as both a page load and a sibling client navigation, and reports in the
 * dev overlay if it stops producing a static shell — so a change that
 * reintroduces blocking data access is surfaced rather than quietly making
 * navigation feel slow again.
 *
 * The Suspense boundary has to live inside this page — see the note in
 * dashboard/facilities/page.tsx for why a boundary in the layout is not
 * enough for navigations arriving from a sibling route.
 */
export const instant = true;

export default function SessionsPage({ searchParams }: SessionsPageProps) {
  return (
    <div className="space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <PageHeader title="Session templates" info="Reusable, color-coded activities. Build one once per department, then place it on any schedule in it." />
      </div>

      {/* searchParams is forwarded unread — awaiting it here would pull this
          static shell into the dynamic, Suspense-gated render. */}
      <Suspense fallback={<SessionsBodySkeleton />}>
        <Streamed className="space-y-6">
          <SessionsBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function SessionsBody({ searchParams }: SessionsPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  // Read-only staff (aux) have nothing to do here, and the navigation not
  // offering this page is not a guard. Coordinators are not read-only.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam, department: departmentParam } = await searchParams;

  const [{ data: facilityRows }, { data: departmentRows }, { data: templateRows }] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, city, province, is_published, photo_urls")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("departments")
      .select("id, name, facility_id")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }) as unknown as Promise<{ data: DepartmentRow[] | null }>,
    // Relational select — cast needed until Supabase CLI generates types with FK relations
    supabase
      .from("session_templates")
      .select(
        "id, name, color, default_duration_minutes, occupancy_kind, disclosure, facility_id, department_id, session_template_spaces ( spaces ( name ) )"
      )
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("display_order", { ascending: true }) as unknown as Promise<{ data: SessionTemplateRow[] | null }>,
  ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const facility = facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0];
  const facilityDepartments = (departmentRows ?? []).filter((d) => d.facility_id === facility.id);
  const activeDepartmentId = departmentParam ?? NO_DEPARTMENT;

  const facilityTemplates = (templateRows ?? []).filter((t) => t.facility_id === facility.id);
  const scopedTemplates = facilityTemplates.filter((t) =>
    activeDepartmentId === NO_DEPARTMENT ? t.department_id === null : t.department_id === activeDepartmentId
  );

  const facilityCards = facilityRows.map((f) => {
    const count = (templateRows ?? []).filter((t) => t.facility_id === f.id).length;
    return { ...f, meta: `${count} template${count !== 1 ? "s" : ""}` };
  });

  const departmentName = facilityDepartments.find((d) => d.id === activeDepartmentId)?.name ?? null;

  return (
    <>
      <FacilityCardPicker
        facilities={facilityCards}
        activeFacilityId={facility.id}
        hrefFor={(facilityId) => sessionsHref({ facilityId })}
      />

      <DepartmentPicker
        departments={facilityDepartments}
        activeDepartmentId={activeDepartmentId}
        hrefFor={(departmentId) => sessionsHref({ facilityId: facility.id, departmentId })}
      />

      <TemplateList
        facility={facility}
        departmentId={activeDepartmentId === NO_DEPARTMENT ? null : activeDepartmentId}
        departmentName={departmentName}
        templates={scopedTemplates}
      />
    </>
  );
}

function TemplateList({
  facility,
  departmentId,
  departmentName,
  templates,
}: {
  facility: { id: string; name: string };
  departmentId: string | null;
  departmentName: string | null;
  templates: SessionTemplateRow[];
}) {
  const newTemplateHref = `/dashboard/sessions/new?facility=${facility.id}&department=${departmentId ?? NO_DEPARTMENT}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          For <span className="font-medium text-foreground">{departmentName ?? "the whole facility"}</span> at{" "}
          {facility.name}
        </p>
        <Button asChild>
          <Link href={newTemplateHref}>
            <Plus />
            New template
          </Link>
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState title="No session templates yet." />
      ) : (
        <div className="bg-card rounded-card border border-border shadow-card divide-y divide-border overflow-hidden">
          {templates.map((template) => (
            // The name's link stretches over the whole row (after:inset-0), so a
            // click anywhere opens the template; the actions sit above it (z-10).
            <div
              key={template.id}
              className="relative flex items-center justify-between px-4 py-3 hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-4 h-4 rounded-full flex-shrink-0 border border-foreground/10"
                  style={{ backgroundColor: template.color ?? "#3B82F6" }}
                />
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/sessions/${template.id}/edit`}
                    className="block text-sm font-medium text-foreground truncate after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                  >
                    {template.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {occupancyKindLabel(template.occupancy_kind)}
                    {template.disclosure !== "public" &&
                      ` · ${template.disclosure === "internal" ? "staff only" : "name withheld"}`}
                    {" · "}
                    {template.default_duration_minutes} min
                    {template.session_template_spaces.length > 0 &&
                      ` · ${template.session_template_spaces.map((r) => r.spaces.name).join(", ")}`}
                  </p>
                </div>
              </div>
              <div className="relative z-10 flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/dashboard/sessions/${template.id}/edit`}>
                    <Pencil />
                    Edit
                  </Link>
                </Button>
                <DeleteSessionTemplateButton templateId={template.id} templateName={template.name} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NoFacilities() {
  return (
    <div className="max-w-2xl mx-auto">
      <EmptyState
        className="py-16"
        title="No buildings yet"
        description="Add a facility first — session templates belong to one."
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard/facilities/new">
              <Plus className="w-4 h-4" />
              Add a facility
            </Link>
          </Button>
        }
      />
    </div>
  );
}

function SessionsBodySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-56 rounded-card shrink-0" />
        ))}
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}
