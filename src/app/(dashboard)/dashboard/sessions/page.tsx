import { Suspense } from "react";
import Link from "next/link";
import { Clock, Pencil, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NO_DEPARTMENT, sessionsHref } from "@/lib/schedule/commandCentreHref";
import { Skeleton } from "@/components/ui/skeleton";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import DepartmentPicker from "@/components/department/DepartmentPicker";
import { Button } from "@/components/ui/button";
import Streamed from "@/components/ui/streamed";

interface SessionsPageProps {
  searchParams: Promise<{ facility?: string; department?: string }>;
}

type DepartmentRow = { id: string; name: string; facility_id: string };

type SessionTemplateRow = {
  id: string;
  name: string;
  color: string | null;
  default_duration_minutes: number;
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
        <h1 className="text-2xl font-bold text-foreground">Session templates</h1>
        <p className="text-muted-foreground mt-1">
          Reusable, color-coded activity definitions — build these once per department, then reuse
          them across every schedule in it instead of filling out a form each time.
        </p>
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
        "id, name, color, default_duration_minutes, facility_id, department_id, session_template_spaces ( spaces ( name ) )"
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
        <Button size="lg" asChild>
          <Link href={newTemplateHref}>
            <Plus />
            New template
          </Link>
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border border-dashed">
          <p className="text-sm text-muted-foreground">No session templates yet.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border divide-y divide-border">
          {templates.map((template) => (
            <div key={template.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-4 h-4 rounded-full flex-shrink-0 border border-black/10"
                  style={{ backgroundColor: template.color ?? "#3B82F6" }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{template.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {template.default_duration_minutes} min
                    {template.session_template_spaces.length > 0 &&
                      ` · ${template.session_template_spaces.map((r) => r.spaces.name).join(", ")}`}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/sessions/${template.id}/edit`}>
                  <Pencil />
                  Edit
                </Link>
              </Button>
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
      <div className="text-center py-16 bg-card rounded-xl border border-dashed border-border">
        <Clock className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
        <h1 className="font-medium text-foreground mb-1">No buildings yet</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Add a facility first — session templates belong to one.
        </p>
        <Link
          href="/dashboard/facilities/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add a facility
        </Link>
      </div>
    </div>
  );
}

function SessionsBodySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-56 rounded-xl shrink-0" />
        ))}
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
