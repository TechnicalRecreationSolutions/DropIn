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
 * A tab strip for switching which department's (or the whole facility's)
 * session templates are shown. "Facility-wide" is always the first tab when
 * there's anything to switch between — it's where templates shared across
 * every schedule in the building live (see session_templates.department_id,
 * nullable, mirroring spaces.department_id). Renders nothing when the
 * facility has no departments at all — facility-wide is then the only
 * possible scope, so there's nothing to pick.
 */
export default function DepartmentPicker({ departments, activeDepartmentId, hrefFor }: DepartmentPickerProps) {
  if (departments.length === 0) return null;

  const tabs = [{ id: NO_DEPARTMENT, name: "Facility-wide" }, ...departments];

  return (
    <div className="border-b border-border">
      <div className="flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeDepartmentId;
          return (
            <Link
              key={tab.id}
              href={hrefFor(tab.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                active
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
