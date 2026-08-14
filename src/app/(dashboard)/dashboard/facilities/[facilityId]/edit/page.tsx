import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import FacilityForm from "@/components/facility/FacilityForm";
import FacilityDangerZone from "@/components/facility/FacilityDangerZone";
import { getFacilityDeletionImpact } from "@/lib/facilities/deletionImpact";

interface EditFacilityPageProps {
  params: Promise<{ facilityId: string }>;
}

export default async function EditFacilityPage({ params }: EditFacilityPageProps) {
  const { facilityId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name, address_line1, city, province, postal_code, phone, email, website_url, description, is_published, photo_urls")
    .eq("id", facilityId)
    .eq("org_id", orgContext.org.id)
    .single();

  if (!facility) notFound();

  const impact = await getFacilityDeletionImpact(facilityId, orgContext.org.id);
  const canDelete = ["owner", "admin"].includes(orgContext.membership.role);

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
        <h1 className="text-2xl font-bold text-gray-900">Edit facility</h1>
        <p className="text-gray-500 mt-1">Update this facility&apos;s details.</p>
      </div>

      <FacilityForm
        facilityId={facilityId}
        orgId={orgContext.org.id}
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
        }}
      />

      <FacilityDangerZone
        facilityId={facilityId}
        facilityName={facility.name}
        impact={impact}
        canDelete={canDelete}
      />
    </div>
  );
}
