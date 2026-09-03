import { notFound } from "next/navigation";
import FacilityForm from "@/components/facility/FacilityForm";
import { getOrgContext } from "@/lib/auth/session";

export const metadata = { title: "Add Facility" };

export default async function NewFacilityPage() {
  // The form uploads a cover photo straight to Storage, and the org id is what
  // decides the folder it lands in — so this page can no longer be static.
  const orgContext = await getOrgContext();
  if (!orgContext) notFound();

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Add a facility</h1>
        <p className="text-muted-foreground mt-1">
          A facility is a physical location where your schedules take place.
        </p>
      </div>
      <FacilityForm orgId={orgContext.org.id} />
    </div>
  );
}
