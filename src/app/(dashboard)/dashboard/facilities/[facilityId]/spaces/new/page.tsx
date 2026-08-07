import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SpaceForm from "@/components/space/SpaceForm";

interface NewSpacePageProps {
  params: Promise<{ facilityId: string }>;
  searchParams: Promise<{ departmentId?: string }>;
}

export default async function NewSpacePage({ params, searchParams }: NewSpacePageProps) {
  const { facilityId } = await params;
  const { departmentId } = await searchParams;
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
          { label: "New space" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Add a space</h1>
        <p className="text-gray-500 mt-1">
          A specific bookable location within this facility (e.g. Lane 3, Court A, Studio 2) that
          sessions can be attached to.
        </p>
      </div>

      <SpaceForm
        facilityId={facilityId}
        departments={departments ?? []}
        defaultValues={departmentId ? { department_id: departmentId } : undefined}
        // Back to the Spaces tab this was launched from.
        redirectTo={commandCentreHref({ facilityId, tab: "spaces" })}
      />
    </div>
  );
}
