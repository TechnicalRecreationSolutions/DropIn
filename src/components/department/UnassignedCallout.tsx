import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { commandCentreHref, spacesHref } from "@/lib/schedule/commandCentreHref";
import { InfoTip } from "@/components/ui/info-tip";

interface UnassignedCalloutProps {
  facilityId: string;
  scheduleGroups: { id: string; name: string; department_id: string | null }[];
  spaces: { id: string; name: string; department_id: string | null }[];
  /** Hidden entirely when the org has no coordinators — it would be noise. */
  hasCoordinators: boolean;
}

/**
 * Schedules and spaces in this building that belong to no department.
 *
 * `schedule_groups.department_id` and `spaces.department_id` are both nullable
 * on purpose (migrations 011 and 012) and always have been. That is fine until
 * the org has a **coordinator**, whose entire authority is expressed through
 * departments: `can_write_department(NULL)` is FALSE, so a department-less
 * schedule is one they cannot open, edit, or even be told about.
 *
 * Failing closed there is right. Failing closed *invisibly* is what this fixes:
 * without it the coordinator reports "my schedule is missing" and the manager
 * finds nothing wrong, because from their own account everything is there.
 *
 * Deliberately shown only when a coordinator exists. A one-person org has no
 * unassigned problem, and a permanent amber box about a state that is correct
 * for them would just teach everyone to ignore amber boxes.
 */
export default function UnassignedCallout({
  facilityId,
  scheduleGroups,
  spaces,
  hasCoordinators,
}: UnassignedCalloutProps) {
  const orphanGroups = scheduleGroups.filter((g) => !g.department_id);
  const orphanSpaces = spaces.filter((s) => !s.department_id);

  if (!hasCoordinators) return null;
  if (orphanGroups.length === 0 && orphanSpaces.length === 0) return null;

  return (
    <div className="rounded-banner bg-warning-subtle p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-warning">
            Hidden from coordinators
          </h2>
          <InfoTip>
            Coordinators only see what&apos;s in their departments, so these stay manager-only.
            Assign a department to make them visible.
          </InfoTip>
        </div>
      </div>

      {orphanGroups.length > 0 && (
        <div>
          <p className="text-label text-muted-foreground pb-1.5">
            Schedules
          </p>
          <div className="flex flex-wrap gap-1.5">
            {orphanGroups.map((g) => (
              <Link
                key={g.id}
                href={commandCentreHref({ facilityId, scheduleGroupId: g.id })}
                className="text-xs px-2.5 py-1 rounded-full bg-card border border-border text-foreground hover:bg-muted transition-colors duration-150"
              >
                {g.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {orphanSpaces.length > 0 && (
        <div>
          <p className="text-label text-muted-foreground pb-1.5">
            Spaces
          </p>
          <div className="flex flex-wrap gap-1.5">
            {orphanSpaces.slice(0, 12).map((s) => (
              <span
                key={s.id}
                className="text-xs px-2.5 py-1 rounded-full bg-card border border-border text-foreground"
              >
                {s.name}
              </span>
            ))}
            {orphanSpaces.length > 12 && (
              <span className="text-xs px-2 py-1 text-muted-foreground">
                +{orphanSpaces.length - 12} more
              </span>
            )}
          </div>
          <Link
            href={spacesHref(facilityId)}
            className="inline-block mt-2 text-xs font-medium text-brand underline-offset-4 hover:underline"
          >
            Assign them on the Spaces page
          </Link>
        </div>
      )}
    </div>
  );
}
