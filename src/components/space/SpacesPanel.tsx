import Link from "next/link";
import { MapPin, Plus } from "lucide-react";
import type { CommandSpace } from "@/components/schedule-command/types";
import SpaceSections from "./SpaceSections";

interface SpacesPanelProps {
  /** Only the fields this panel actually reads — a full `CommandFacility` satisfies this too. */
  facility: { id: string; name: string; spaces: CommandSpace[] };
  /** The building's departments, in display order. */
  departments: { id: string; name: string }[];
}

/**
 * The bookable locations sessions attach to — lanes, courts, studios.
 * Backs the dedicated Spaces page (`/dashboard/spaces/page.tsx`).
 *
 * Grouped by department, then by `zone_name` (migration 054), rather than
 * listed flat. `spaces.department_id` has existed since migration 012 and both
 * API routes already validate it — this page was the one place that read the
 * column and threw it away, so a pool's eight lanes and the tennis court
 * rendered as one undifferentiated wall of identical cards.
 *
 * This shell is a server component; the grouped body is not, because
 * reordering needs optimistic state. Keeping the intro, the empty state and
 * the "Add space" link out here means they stay in the prerendered shell.
 */
export default function SpacesPanel({ facility, departments }: SpacesPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Bookable locations in {facility.name} that sessions can be placed into. Their order here
          is the order they appear in when building a session.
        </p>
        <Link
          href={`/dashboard/facilities/${facility.id}/spaces/new`}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add space
        </Link>
      </div>

      {facility.spaces.length === 0 ? (
        <EmptyState facilityId={facility.id} />
      ) : (
        <SpaceSections
          facilityId={facility.id}
          departments={departments}
          spaces={facility.spaces}
        />
      )}
    </div>
  );
}

function EmptyState({ facilityId }: { facilityId: string }) {
  return (
    <div className="text-center py-14 bg-card rounded-xl border border-dashed border-border">
      <MapPin className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
      <h3 className="font-medium text-foreground mb-1">No spaces yet</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
        Add a space (e.g. &quot;Lane 3&quot;, &quot;Court A&quot;) to give sessions a specific
        location — the Map view and floorplan both build on these.
      </p>
      <Link
        href={`/dashboard/facilities/${facilityId}/spaces/new`}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add a space
      </Link>
    </div>
  );
}
