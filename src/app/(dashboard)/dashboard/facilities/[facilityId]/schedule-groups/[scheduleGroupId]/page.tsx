import { redirect } from "next/navigation";
import { commandCentreHref, NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";

interface FacilityScheduleGroupPageProps {
  params: Promise<{ facilityId: string; scheduleGroupId: string }>;
}

/**
 * A schedule opens in exactly one place: the command centre, scoped to it.
 *
 * This route used to be a detail page whose main action was "open the
 * builder" — a landing you had to click through before you could change
 * anything. That step is gone, but the URL stays as a redirect so existing
 * links, bookmarks, and the tree nav's older shape all still resolve.
 */
export default async function FacilityScheduleGroupPage({ params }: FacilityScheduleGroupPageProps) {
  const { facilityId, scheduleGroupId } = await params;
  redirect(
    commandCentreHref({
      facilityId,
      // This route only ever served schedules with no department.
      departmentId: NO_DEPARTMENT,
      scheduleGroupId,
    })
  );
}
