import { redirect } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";

interface FacilityDetailPageProps {
  params: Promise<{ facilityId: string }>;
}

/**
 * A building is managed in one place now: the command centre, which carries
 * this facility's schedules, spaces, floorplan, and widget config as tabs
 * over a single scope selection.
 *
 * This route used to be a detail page with its own Overview/Spaces/Map/
 * Widget tabs — the second of three layers you clicked through before
 * reaching any actual work. The URL survives as a redirect so bookmarks and
 * older links keep resolving.
 */
export default async function FacilityDetailPage({ params }: FacilityDetailPageProps) {
  const { facilityId } = await params;
  redirect(commandCentreHref({ facilityId }));
}
