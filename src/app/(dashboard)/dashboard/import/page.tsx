import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import ImportWizard from "@/components/import/ImportWizard";

export default async function ImportPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("org_id", orgContext.org.id)
    .order("name") as unknown as { data: { id: string; name: string }[] | null };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import schedule</h1>
        <p className="text-gray-500 mt-1">
          Upload a CSV or Excel file to bulk-import schedules and sessions.
        </p>
      </div>
      <ImportWizard facilities={facilities ?? []} />
    </div>
  );
}
