import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { commandCentreHref, spacesHref } from "@/lib/schedule/commandCentreHref";

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
    <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Not in any department — coordinators cannot see these
          </h2>
          <p className="text-xs text-amber-900/80 dark:text-amber-200/80 mt-0.5">
            A coordinator&apos;s access runs through departments, so anything filed under none
            of them stays manager-only. Assign a department and it appears for them.
          </p>
        </div>
      </div>

      {orphanGroups.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/70 dark:text-amber-200/70 pb-1">
            Schedules
          </p>
          <div className="flex flex-wrap gap-1.5">
            {orphanGroups.map((g) => (
              <Link
                key={g.id}
                href={commandCentreHref({ facilityId, scheduleGroupId: g.id })}
                className="text-xs px-2 py-1 rounded-md bg-card border border-amber-200 dark:border-amber-900 text-foreground hover:bg-muted transition-colors"
              >
                {g.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {orphanSpaces.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/70 dark:text-amber-200/70 pb-1">
            Spaces
          </p>
          <div className="flex flex-wrap gap-1.5">
            {orphanSpaces.slice(0, 12).map((s) => (
              <span
                key={s.id}
                className="text-xs px-2 py-1 rounded-md bg-card border border-amber-200 dark:border-amber-900 text-foreground"
              >
                {s.name}
              </span>
            ))}
            {orphanSpaces.length > 12 && (
              <span className="text-xs px-2 py-1 text-amber-900/80 dark:text-amber-200/80">
                +{orphanSpaces.length - 12} more
              </span>
            )}
          </div>
          <Link
            href={spacesHref(facilityId)}
            className="inline-block mt-2 text-xs font-medium text-amber-900 dark:text-amber-200 underline hover:no-underline"
          >
            Assign them on the Spaces page
          </Link>
        </div>
      )}
    </div>
  );
}
