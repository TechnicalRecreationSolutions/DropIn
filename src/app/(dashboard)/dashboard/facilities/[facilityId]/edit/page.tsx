import { notFound, redirect } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { can, isReadOnly } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import FacilityForm from "@/components/facility/FacilityForm";
import FacilityDangerZone from "@/components/facility/FacilityDangerZone";
import { getFacilityDeletionImpact } from "@/lib/facilities/deletionImpact";
import { PageHeader } from "@/components/ui/info-tip";
import PublicConditionsSettings from "@/components/conditions/PublicConditionsSettings";

interface EditFacilityPageProps {
  params: Promise<{ facilityId: string }>;
}

export default async function EditFacilityPage({ params }: EditFacilityPageProps) {
  const { facilityId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  // Read-only staff (aux) have nothing to do here, and the navigation not
  // offering this page is not a guard. Coordinators are not read-only.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

  const supabase = await createClient();

  const [{ data: facility }, { count: readingCount }] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, address_line1, city, province, postal_code, phone, email, website_url, description, is_published, listed_in_directory, lat, geocoded_at, photo_urls, public_conditions, public_headcount, occupancy_capacity")
      .eq("id", facilityId)
      .eq("org_id", orgContext.org.id)
      .single(),
    // Only "has anything ever been recorded?", for the settings' empty-state note.
    supabase
      .from("facility_readings")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId),
  ]);

  if (!facility) notFound();

  const impact = await getFacilityDeletionImpact(facilityId, orgContext.org.id);
  const canDelete = can(
    { role: orgContext.membership.role, scopes: orgContext.scopes },
    "facility:delete"
  );

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: "Edit" },
        ]}
      />
      <div className="mb-6">
        <PageHeader title="Edit facility" />
      </div>

      <FacilityForm
        facilityId={facilityId}
        orgId={orgContext.org.id}
        orgVerified={!!orgContext.org.approved_at}
        defaultValues={{
          photo_urls: facility.photo_urls ?? [],
          name: facility.name,
          address_line1: facility.address_line1,
          city: facility.city,
          province: facility.province,
          postal_code: facility.postal_code,
          phone: facility.phone ?? "",
          email: facility.email ?? "",
          website_url: facility.website_url ?? "",
          description: facility.description ?? "",
          is_published: facility.is_published,
          listed_in_directory: facility.listed_in_directory,
        }}
        locationStatus={
          facility.lat !== null ? "found" : facility.geocoded_at ? "not_found" : "pending"
        }
      />

      {/* What patrons are shown from the counts and temperatures staff record.
          Moved here from the status page (2026-10-01): it is configuration,
          set once by a manager, and that page is for the shift. */}
      <div className="mt-10 border-t border-border pt-6">
        <PublicConditionsSettings
          facilityId={facilityId}
          statusHref={`/dashboard/facilities/${facilityId}/status#people`}
          initial={{
            publicConditions: facility.public_conditions,
            publicHeadcount: facility.public_headcount,
            occupancyCapacity: facility.occupancy_capacity,
          }}
          canEdit={can({ role: orgContext.membership.role, scopes: orgContext.scopes }, "facility:edit")}
          hasReadings={(readingCount ?? 0) > 0}
        />
      </div>

      <FacilityDangerZone
        facilityId={facilityId}
        facilityName={facility.name}
        impact={impact}
        canDelete={canDelete}
      />
    </div>
  );
}
