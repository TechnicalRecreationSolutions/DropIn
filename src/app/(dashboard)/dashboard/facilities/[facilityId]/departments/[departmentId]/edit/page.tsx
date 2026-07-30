import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import DepartmentForm from "@/components/department/DepartmentForm";

interface EditDepartmentPageProps {
  params: Promise<{ facilityId: string; departmentId: string }>;
}

type DepartmentRow = {
  id: string;
  name: string;
  description: string | null;
  is_published: boolean;
};

export default async function EditDepartmentPage({ params }: EditDepartmentPageProps) {
  const { facilityId, departmentId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("id", facilityId)
    .eq("org_id", orgContext.org.id)
    .single() as unknown as { data: { id: string; name: string } | null };

  if (!facility) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: department } = await (supabase as any)
    .from("departments")
    .select("id, name, description, is_published")
    .eq("id", departmentId)
    .eq("facility_id", facilityId)
    .single() as { data: DepartmentRow | null };

  if (!department) notFound();

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: `/dashboard/facilities/${facilityId}` },
          { label: department.name, href: `/dashboard/facilities/${facilityId}/departments/${departmentId}` },
          { label: "Edit" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit department</h1>
        <p className="text-gray-500 mt-1">Update this department&apos;s details.</p>
      </div>

      <DepartmentForm
        facilityId={facilityId}
        departmentId={departmentId}
        defaultValues={{
          name: department.name,
          description: department.description ?? "",
          is_published: department.is_published,
        }}
        redirectTo={`/dashboard/facilities/${facilityId}/departments/${departmentId}`}
      />
    </div>
  );
}
