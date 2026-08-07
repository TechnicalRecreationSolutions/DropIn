import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SpaceForm from "@/components/space/SpaceForm";

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
    .select("id, name, department_id, description, capacity, is_published")
    .eq("id", spaceId)
    .eq("facility_id", facilityId)
    .single();

  if (!space) notFound();

  const { data: departments } = await supabase
    .from("departments")
    .select("id, name")
    .eq("facility_id", facilityId)
    .order("display_order", { ascending: true });

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: space.name, href: commandCentreHref({ facilityId }) },
          { label: "Edit" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit space</h1>
        <p className="text-gray-500 mt-1">Update this space&apos;s details.</p>
      </div>

      <SpaceForm
        facilityId={facilityId}
        spaceId={spaceId}
        departments={departments ?? []}
        defaultValues={{
          name: space.name,
          department_id: space.department_id,
          description: space.description ?? "",
          capacity: space.capacity,
          is_published: space.is_published,
        }}
        // Back to the Spaces tab this was launched from.
        redirectTo={commandCentreHref({ facilityId, tab: "spaces" })}
      />
    </div>
  );
}
