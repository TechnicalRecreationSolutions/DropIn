import { redirect } from "next/navigation";
import { NO_DEPARTMENT, sessionsHref } from "@/lib/schedule/commandCentreHref";

interface SessionTemplatesPageProps {
  params: Promise<{ facilityId: string; scheduleGroupId: string }>;
}

/**
 * Session templates live on their own dedicated route now (/dashboard/sessions,
 * scoped by query string) — same move the command centre itself made. This
 * URL stays as a redirect so existing links and bookmarks still resolve. See
 * facilities/[facilityId]/schedule-groups/[scheduleGroupId]/page.tsx for the
 * precedent.
 */
export default async function SessionTemplatesPage({ params }: SessionTemplatesPageProps) {
  const { facilityId, scheduleGroupId } = await params;
  redirect(
    sessionsHref({
      facilityId,
      // This route only ever served schedules with no department.
      departmentId: NO_DEPARTMENT,
      scheduleGroupId,
    })
  );
}
