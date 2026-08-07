import { redirect } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";

interface DepartmentScheduleGroupPageProps {
  params: Promise<{ facilityId: string; departmentId: string; scheduleGroupId: string }>;
}

/**
 * Department-scoped twin of the facility schedule-group route — same
 * reasoning: a schedule is edited on the command centre, so this URL only
 * exists now to redirect there with the right scope preselected.
 */
export default async function DepartmentScheduleGroupPage({ params }: DepartmentScheduleGroupPageProps) {
  const { facilityId, departmentId, scheduleGroupId } = await params;
  redirect(commandCentreHref({ facilityId, departmentId, scheduleGroupId }));
}
