import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import ProgramForm from "@/components/program/ProgramForm";

export const metadata = { title: "Add Program" };

export default async function NewProgramPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("org_id", orgContext.org.id)
    .order("name");

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Add a program</h1>
        <p className="text-gray-500 mt-1">
          A program is a recurring activity like Lap Swim or Drop-in Hockey.
          You&apos;ll set the schedule after creating the program.
        </p>
      </div>
      <ProgramForm facilities={facilities ?? []} orgId={orgContext.org.id} />
    </div>
  );
}
