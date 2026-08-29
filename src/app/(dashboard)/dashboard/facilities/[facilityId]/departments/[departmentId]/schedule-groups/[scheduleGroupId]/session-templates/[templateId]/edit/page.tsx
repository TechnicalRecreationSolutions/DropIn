import { redirect } from "next/navigation";

interface EditSessionTemplatePageProps {
  params: Promise<{ templateId: string }>;
}

/** Session templates live at /dashboard/sessions/[templateId]/edit now — see the list route's redirect stub two levels up. */
export default async function EditSessionTemplatePage({ params }: EditSessionTemplatePageProps) {
  const { templateId } = await params;
  redirect(`/dashboard/sessions/${templateId}/edit`);
}
