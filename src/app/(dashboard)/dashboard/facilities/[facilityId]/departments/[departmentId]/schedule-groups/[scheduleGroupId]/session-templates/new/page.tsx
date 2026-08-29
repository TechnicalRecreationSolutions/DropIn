import { redirect } from "next/navigation";

interface NewSessionTemplatePageProps {
  params: Promise<{ scheduleGroupId: string }>;
}

/** Session templates live at /dashboard/sessions/new now — see the list route's redirect stub one level up. */
export default async function NewSessionTemplatePage({ params }: NewSessionTemplatePageProps) {
  const { scheduleGroupId } = await params;
  redirect(`/dashboard/sessions/new?schedule=${scheduleGroupId}`);
}
