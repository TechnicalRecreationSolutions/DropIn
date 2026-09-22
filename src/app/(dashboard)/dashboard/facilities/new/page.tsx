import { notFound } from "next/navigation";
import FacilityForm from "@/components/facility/FacilityForm";
import { getOrgContext } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/info-tip";

export const metadata = { title: "Add Facility" };

export default async function NewFacilityPage() {
  // The form uploads a cover photo straight to Storage, and the org id is what
  // decides the folder it lands in — so this page can no longer be static.
  const orgContext = await getOrgContext();
  if (!orgContext) notFound();

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <PageHeader title="Add a facility" info="A physical location where your schedules run." />
      </div>
      <FacilityForm orgId={orgContext.org.id} orgVerified={!!orgContext.org.approved_at} locationStatus="pending" />
    </div>
  );
}
