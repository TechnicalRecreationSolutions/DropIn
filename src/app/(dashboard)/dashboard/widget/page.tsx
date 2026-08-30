import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import WidgetConfigurator from "@/components/widget/WidgetConfigurator";

interface WidgetPageProps {
  searchParams: Promise<{ facility?: string; department?: string }>;
}

export default async function WidgetPage({ searchParams }: WidgetPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { facility, department } = await searchParams;

  const supabase = await createClient();
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("org_id", orgContext.org.id)
    .order("name");

  // Only carry the sidebar's current facility/department into the picker if
  // it actually belongs to this org — otherwise fall back to unscoped rather
  // than pre-selecting an id that won't resolve to anything.
  const initialFacilityId = facilities?.some((f) => f.id === facility) ? facility : undefined;
  let initialDepartmentId: string | undefined;
  if (initialFacilityId && department) {
    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .eq("id", department)
      .eq("facility_id", initialFacilityId)
      .maybeSingle();
    initialDepartmentId = dept?.id;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Embed widget</h1>
        <p className="text-gray-500 mt-1">
          Add your drop-in schedule to your website with a single script tag.
        </p>
      </div>
      <WidgetConfigurator
        orgId={orgContext.org.id}
        facilities={facilities ?? []}
        initialFacilityId={initialFacilityId}
        initialDepartmentId={initialDepartmentId}
      />
    </div>
  );
}
