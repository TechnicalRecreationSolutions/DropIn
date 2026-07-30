import Breadcrumb from "@/components/layout/Breadcrumb";
import DepartmentForm from "@/components/department/DepartmentForm";

interface NewDepartmentPageProps {
  params: Promise<{ facilityId: string }>;
}

export default async function NewDepartmentPage({ params }: NewDepartmentPageProps) {
  const { facilityId } = await params;

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: "Facility", href: `/dashboard/facilities/${facilityId}` },
          { label: "New department" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Add a department</h1>
        <p className="text-gray-500 mt-1">
          A department groups related schedules together (e.g. Aquatics, Fitness).
        </p>
      </div>

      <DepartmentForm
        facilityId={facilityId}
        redirectTo={`/dashboard/facilities/${facilityId}`}
      />
    </div>
  );
}
