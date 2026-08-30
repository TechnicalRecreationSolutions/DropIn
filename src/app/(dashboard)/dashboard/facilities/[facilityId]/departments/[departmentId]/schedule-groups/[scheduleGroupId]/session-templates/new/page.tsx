import { redirect } from "next/navigation";

interface NewSessionTemplatePageProps {
  params: Promise<{ facilityId: string; departmentId: string }>;
}

/**
 * Session templates live at /dashboard/sessions/new now, scoped by
 * facility/department rather than schedule — see the list route's redirect
 * stub one level up.
 */
export default async function NewSessionTemplatePage({ params }: NewSessionTemplatePageProps) {
  const { facilityId, departmentId } = await params;
  redirect(`/dashboard/sessions/new?facility=${facilityId}&department=${departmentId}`);
}
