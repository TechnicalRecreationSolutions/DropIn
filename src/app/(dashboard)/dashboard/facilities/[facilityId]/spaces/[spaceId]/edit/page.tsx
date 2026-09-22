import { notFound } from "next/navigation";
import { spacesHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SpaceForm from "@/components/space/SpaceForm";
import { PageHeader } from "@/components/ui/info-tip";

interface EditSpacePageProps {
  params: Promise<{ facilityId: string; spaceId: string }>;
}

export default async function EditSpacePage({ params }: EditSpacePageProps) {
  const { facilityId, spaceId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("id", facilityId)
    .eq("org_id", orgContext.org.id)
    .single();

  if (!facility) notFound();

  const { data: space } = await supabase
    .from("spaces")
    .select("*")
    .eq("id", spaceId)
    .eq("facility_id", facilityId)
    .single();

  if (!space) notFound();

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
          { label: space.name, href: spacesHref(facilityId) },
          { label: "Edit" },
        ]}
      />
      <div className="mb-6">
        <PageHeader title="Edit space" />
      </div>

      <SpaceForm
        facilityId={facilityId}
        spaceId={spaceId}
        departments={departments ?? []}
        zoneNames={zoneNames}
        defaultValues={{
          name: space.name,
          department_id: space.department_id,
          zone_name: space.zone_name ?? "",
          description: space.description ?? "",
          capacity: space.capacity,
          is_published: space.is_published,
        }}
        // Back to the Spaces page this was launched from.
        redirectTo={spacesHref(facilityId)}
      />
    </div>
  );
}
