import Breadcrumb from "@/components/layout/Breadcrumb";
import DepartmentForm from "@/components/department/DepartmentForm";
import { departmentsHref } from "@/lib/schedule/commandCentreHref";
import { PageHeader } from "@/components/ui/info-tip";

interface NewDepartmentPageProps {
  params: Promise<{ facilityId: string }>;
}

export default async function NewDepartmentPage({ params }: NewDepartmentPageProps) {
  const { facilityId } = await params;

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Departments", href: departmentsHref(facilityId) },
          { label: "New department" },
        ]}
      />
      <div className="mb-6">
        <PageHeader title="Add a department" info="A department groups related schedules, such as Aquatics or Fitness." />
      </div>

      <DepartmentForm
        facilityId={facilityId}
        redirectTo={departmentsHref(facilityId)}
      />
    </div>
  );
}
