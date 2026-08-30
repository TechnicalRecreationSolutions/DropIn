import { notFound, redirect } from "next/navigation";
import { NO_DEPARTMENT, sessionsHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import SessionTemplateForm from "@/components/session-template/SessionTemplateForm";

interface NewSessionTemplatePageProps {
  searchParams: Promise<{ facility?: string; department?: string }>;
}

export default async function NewSessionTemplatePage({ searchParams }: NewSessionTemplatePageProps) {
  const { facility: facilityId, department: departmentParam } = await searchParams;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  // A template always belongs to a facility (and, optionally, one of its
  // departments) — without a facility there's nothing to attach it to, so
  // send staff back to pick one first.
  if (!facilityId) redirect("/dashboard/sessions");

  const supabase = await createClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("id", facilityId)
    .eq("org_id", orgContext.org.id)
    .single();

  if (!facility) notFound();

  let department: { id: string; name: string } | null = null;
  if (departmentParam && departmentParam !== NO_DEPARTMENT) {
    const { data } = await supabase
      .from("departments")
      .select("id, name")
      .eq("id", departmentParam)
      .eq("facility_id", facility.id)
      .eq("org_id", orgContext.org.id)
      .maybeSingle();

    if (!data) notFound();
    department = data;
  }

  const { data: spaces } = await supabase
    .from("spaces")
    .select("id, name")
    .eq("facility_id", facility.id)
    .order("display_order", { ascending: true });

  const redirectTo = sessionsHref({
    facilityId: facility.id,
    departmentId: department?.id ?? NO_DEPARTMENT,
  });

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New session template</h1>
        <p className="text-gray-500 mt-1">
          Define a reusable activity — its name, color, default duration, and usual space — once,
          then reuse it across every schedule in {department ? department.name : facility.name}.
        </p>
      </div>

      <SessionTemplateForm
        facilityId={facility.id}
        departmentId={department?.id ?? null}
        spaces={spaces ?? []}
        redirectTo={redirectTo}
      />
    </div>
  );
}
