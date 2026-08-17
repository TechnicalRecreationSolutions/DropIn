import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import WidgetConfigurator from "@/components/widget/WidgetConfigurator";

export default async function WidgetPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("org_id", orgContext.org.id)
    .order("name");

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
      />
    </div>
  );
}
