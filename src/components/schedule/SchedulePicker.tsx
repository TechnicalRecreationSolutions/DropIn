import Link from "next/link";
import { cn } from "@/lib/utils/cn";

interface SchedulePickerGroup {
  id: string;
  name: string;
  department_id: string | null;
  departments: { name: string } | null;
}

interface SchedulePickerProps {
  groups: SchedulePickerGroup[];
  activeGroupId: string | null;
  hrefFor: (group: SchedulePickerGroup) => string;
}

/**
 * A row of schedule links, styled like FacilityPicker's tab strip. Renders
 * nothing for a facility with a single schedule — there's nothing to switch
 * between.
 */
export default function SchedulePicker({ groups, activeGroupId, hrefFor }: SchedulePickerProps) {
  if (groups.length < 2) return null;

  return (
    <div className="border-b border-gray-200">
      <div className="flex gap-1 overflow-x-auto">
        {groups.map((g) => {
          const active = g.id === activeGroupId;
          return (
            <Link
              key={g.id}
              href={hrefFor(g)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                active
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              )}
            >
              {g.departments ? `${g.departments.name} — ${g.name}` : g.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
