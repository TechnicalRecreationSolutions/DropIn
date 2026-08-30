import { redirect } from "next/navigation";
import { NO_DEPARTMENT, sessionsHref } from "@/lib/schedule/commandCentreHref";

interface SessionTemplatesPageProps {
  params: Promise<{ facilityId: string }>;
}

/**
 * Session templates live on their own dedicated route now (/dashboard/sessions,
 * scoped by facility/department, not schedule) — same move the command
 * centre itself made. This URL stays as a redirect so existing links and
 * bookmarks still resolve. See
 * facilities/[facilityId]/schedule-groups/[scheduleGroupId]/page.tsx for the
 * precedent. This route only ever served schedules with no department.
 */
export default async function SessionTemplatesPage({ params }: SessionTemplatesPageProps) {
  const { facilityId } = await params;
  redirect(sessionsHref({ facilityId, departmentId: NO_DEPARTMENT }));
}
