import { notFound, redirect } from "next/navigation";
import { spacesHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { isReadOnly } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SpaceForm from "@/components/space/SpaceForm";
import { PageHeader } from "@/components/ui/info-tip";

interface NewSpacePageProps {
  params: Promise<{ facilityId: string }>;
  searchParams: Promise<{ departmentId?: string }>;
}

export default async function NewSpacePage({ params, searchParams }: NewSpacePageProps) {
  const { facilityId } = await params;
  const { departmentId } = await searchParams;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  // Read-only staff (aux) have nothing to do here, and the navigation not
  // offering this page is not a guard. Coordinators are not read-only.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

  const supabase = await createClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("id", facilityId)
    .eq("org_id", orgContext.org.id)
    .single();

  if (!facility) notFound();

  const { data: departments } = await supabase
    .from("departments")
    .select("id, name")
    .eq("facility_id", facilityId)
    .order("display_order", { ascending: true });

  // Zone labels already in use at this facility, for the form's suggestions.
  // select("*") so this still works before migration 054 is applied.
  const { data: zoneRows } = await supabase
    .from("spaces")
    .select("*")
    .eq("facility_id", facilityId);

  const zoneNames = [
    ...new Set(
      (zoneRows ?? [])
        .map((s) => s.zone_name?.trim())
        .filter((z): z is string => !!z)
    ),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: spacesHref(facilityId) },
          { label: "New space" },
        ]}
      />
      <div className="mb-6">
        <PageHeader title="Add a space" info="A bookable location in this facility, such as Lane 3, Court A or Studio 2." />
      </div>

      <SpaceForm
        facilityId={facilityId}
        departments={departments ?? []}
        zoneNames={zoneNames}
        defaultValues={departmentId ? { department_id: departmentId } : undefined}
        // Back to the Spaces page this was launched from.
        redirectTo={spacesHref(facilityId)}
      />
    </div>
  );
}
