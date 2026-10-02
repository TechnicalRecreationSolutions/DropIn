import Link from "next/link";
import { CalendarDays, MapPinOff, Pencil } from "lucide-react";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { Button } from "@/components/ui/button";
import FacilityStatusLink from "@/components/facilities/FacilityStatusLink";
import { LOCATION_COPY, addressHref, type FacilityMapItem } from "./types";

/**
 * What can be done with a selected facility: open its schedule, post a
 * status, edit it. The floating card (desktop) and an expanded list row
 * (phone) render the same thing.
 *
 * None of these is the ink `default` button — the page's one is Add facility.
 */
export default function FacilityActions({ facility }: { facility: FacilityMapItem }) {
  return (
    <div className="space-y-3">
      {facility.locationState !== "located" && (
        <Link
          href={addressHref(facility.id)}
          className="flex items-center gap-2 text-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <MapPinOff className="size-3.5 shrink-0" aria-hidden />
          {LOCATION_COPY[facility.locationState]}
        </Link>
      )}
      <FacilityStatusLink
        facilityId={facility.id}
        liveCount={facility.live_notice_count}
        worstSeverity={facility.worst_notice_severity}
        className="rounded-control px-3 py-2"
      />
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={commandCentreHref({ facilityId: facility.id })}>
            <CalendarDays aria-hidden />
            Schedule
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/dashboard/facilities/${facility.id}/edit`}>
            <Pencil aria-hidden />
            Edit
          </Link>
        </Button>
      </div>
    </div>
  );
}
