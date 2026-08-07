import { redirect } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";

interface DepartmentDetailPageProps {
  params: Promise<{ facilityId: string; departmentId: string }>;
}

/**
 * Departments no longer have a page of their own — they're a filter tier on
 * the command centre, where the same schedules, spaces, and widget config
 * they used to own are reachable without another navigation.
 *
 * Kept as a redirect so existing links resolve to the right scope.
 */
export default async function DepartmentDetailPage({ params }: DepartmentDetailPageProps) {
  const { facilityId, departmentId } = await params;
  redirect(commandCentreHref({ facilityId, departmentId }));
}
