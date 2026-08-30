import { redirect } from "next/navigation";
import { NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";

interface NewSessionTemplatePageProps {
  params: Promise<{ facilityId: string }>;
}

/**
 * Session templates live at /dashboard/sessions/new now, scoped by
 * facility/department rather than schedule — see the list route's redirect
 * stub one level up. This route only ever served schedules with no
 * department.
 */
export default async function NewSessionTemplatePage({ params }: NewSessionTemplatePageProps) {
  const { facilityId } = await params;
  redirect(`/dashboard/sessions/new?facility=${facilityId}&department=${NO_DEPARTMENT}`);
}
