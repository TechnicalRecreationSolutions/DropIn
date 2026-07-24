import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/session";
import SessionForm from "@/components/schedule-editor/SessionForm";

export default async function NewSessionPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: programs } = await (supabase as any)
    .from("programs")
    .select("id, name, facilities(name)")
    .eq("org_id", orgContext.org.id)
    .eq("is_published", false)
    .order("name") as unknown as {
      data: { id: string; name: string; facilities: { name: string } | null }[] | null
    };

  // Also fetch published programs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allPrograms } = await (supabase as any)
    .from("programs")
    .select("id, name, facilities(name)")
    .eq("org_id", orgContext.org.id)
    .order("name") as unknown as {
      data: { id: string; name: string; facilities: { name: string } | null }[] | null
    };

  const programList = (allPrograms ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    facility_name: p.facilities?.name ?? "Unknown facility",
  }));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add session</h1>
        <p className="text-gray-500 mt-1">Define a recurring schedule for one of your programs.</p>
      </div>
      <SessionForm programs={programList} />
    </div>
  );
}
