import Link from "next/link";
import { NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";
import { cn } from "@/lib/utils/cn";

interface DepartmentPickerProps {
  departments: { id: string; name: string }[];
  /** A real department id, or NO_DEPARTMENT for the facility-wide scope. */
  activeDepartmentId: string;
  hrefFor: (departmentId: string) => string;
}

/**
 * A row of small pills for switching which department's (or the whole
 * facility's) session templates are shown. "Facility-wide" is always the
 * first pill when there's anything to switch between — it's where templates
 * shared across every schedule in the building live (see
 * session_templates.department_id, nullable, mirroring spaces.department_id).
 * Renders nothing when the facility has no departments at all —
 * facility-wide is then the only possible scope, so there's nothing to pick.
 * Wraps rather than scrolling (the old scroll container showed a pointless
 * scrollbar), and sits a size below FacilityCardPicker since it filters
 * within the chosen facility.
 */
export default function DepartmentPicker({ departments, activeDepartmentId, hrefFor }: DepartmentPickerProps) {
  if (departments.length === 0) return null;

  const tabs = [{ id: NO_DEPARTMENT, name: "Facility-wide" }, ...departments];

  return (
    <nav aria-label="Department">
      <ul className="flex flex-wrap items-center gap-1.5">
        {tabs.map((tab) => {
          const active = tab.id === activeDepartmentId;
          return (
            <li key={tab.id}>
              <Link
                href={hrefFor(tab.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-full px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                  active
                    ? "bg-blue-600 text-white dark:bg-blue-500"
                    : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
              >
                {tab.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
