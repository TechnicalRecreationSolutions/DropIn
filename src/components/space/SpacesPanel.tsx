import Link from "next/link";
import { Plus } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { EmptyState as EmptyStateBox } from "@/components/ui/empty-state";
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <h2 className="text-heading text-foreground truncate">{facility.name}</h2>
          <InfoTip>
            Drag a space by its handle, or use the arrows, to reorder it within its zone. The order
            here is the order spaces appear in when building a session.
          </InfoTip>
        </div>
        <Button asChild className="shrink-0">
          <Link href={`/dashboard/facilities/${facility.id}/spaces/new`}>
            <Plus className="w-4 h-4" />
            Add space
          </Link>
        </Button>
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
    <EmptyStateBox
      title="No spaces yet"
      description={<>Add spaces such as &quot;Lane 3&quot; or &quot;Court A&quot; to give sessions a location.</>}
      action={
        <Button asChild variant="outline">
          <Link href={`/dashboard/facilities/${facilityId}/spaces/new`}>
            <Plus className="w-4 h-4" />
            Add a space
          </Link>
        </Button>
      }
    />
  );
}
