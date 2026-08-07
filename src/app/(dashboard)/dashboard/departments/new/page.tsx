import Link from "next/link";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import DepartmentForm from "@/components/department/DepartmentForm";

export default async function NewDepartmentPage() {
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
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: "New department" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Add a department</h1>
        <p className="text-gray-500 mt-1">
          A department groups related schedules together (e.g. Aquatics, Fitness).
        </p>
      </div>

      {facilities && facilities.length > 0 ? (
        <DepartmentForm facilities={facilities} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-gray-600">You need a facility before you can add a department.</p>
          <Link
            href="/dashboard/facilities/new"
            className="inline-flex mt-4 items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add a facility
          </Link>
        </div>
      )}
    </div>
  );
}
