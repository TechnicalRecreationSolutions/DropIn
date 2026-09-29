import { redirect } from "next/navigation";
import Link from "next/link";
import { getOrgContext } from "@/lib/auth/session";
import { isReadOnly } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import DepartmentForm from "@/components/department/DepartmentForm";
import { departmentsHref } from "@/lib/schedule/commandCentreHref";
import { PageHeader } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default async function NewDepartmentPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  // Read-only staff (aux) have nothing to do here, and the navigation not
  // offering this page is not a guard. Coordinators are not read-only.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

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
          { label: "Departments", href: departmentsHref() },
          { label: "New department" },
        ]}
      />
      <div className="mb-6">
        <PageHeader title="Add a department" info="A department groups related schedules, such as Aquatics or Fitness." />
      </div>

      {facilities && facilities.length > 0 ? (
        <DepartmentForm facilities={facilities} />
      ) : (
        <EmptyState
          title="You need a facility before you can add a department."
          action={
            <Button asChild variant="outline">
              <Link href="/dashboard/facilities/new">Add a facility</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
