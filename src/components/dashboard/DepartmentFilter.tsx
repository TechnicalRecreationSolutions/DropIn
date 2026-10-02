"use client";

import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TickBoxDropdown from "@/components/schedule/TickBoxDropdown";
import { cn } from "@/lib/utils/cn";

/** The filter's value for "every department" — a missing `?department` in the URL. */
const ALL = "__all__";

/**
 * The page-level department filter (docs/DESIGN.md "Scope and filters").
 *
 * Shown only in the toolbar of a page that is department-aware, and only when
 * there is a choice to make: a coordinator with one department, or a building
 * with none, gets no control at all — never one that is present and ignored.
 *
 * The URL is the state (`?department=`). Changing it drops `?schedule` and
 * `?week`, which belong to whatever was open in the old department. The
 * building is not this control's business — it comes from the sidebar's
 * switcher, and switching building drops `?department` with everything else.
 *
 * `options` are the departments this viewer may pick (the caller filters a
 * coordinator's to their own), plus any page-specific bucket such as
 * "No department" or "Facility-wide". `allLabel` makes nothing-ticked mean
 * "All …", as in the widget; without it the page must pass a `value`.
 */
export default function DepartmentFilter({
  options,
  value,
  allLabel,
  className,
}: {
  options: { id: string; name: string }[];
  /** The department in use; null = all. */
  value: string | null;
  allLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = `department-filter${useId()}`;

  if (options.length < 2) return null;

  const items = options.map((o) => ({ value: o.id, label: o.name }));

  function pick(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === ALL) params.delete("department");
    else params.set("department", next);
    params.delete("schedule");
    params.delete("week");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <TickBoxDropdown
      id={id}
      label="Department"
      allLabel={allLabel ?? "Choose a department"}
      items={items}
      selected={value ? [value] : []}
      // With an "All", exactly the widget's filter: nothing ticked is "All
      // departments", ticking the ticked one (or "Clear") goes back to it.
      // Without one there is always a department, so it cannot be unticked.
      onChange={(next) => (next[0] ? pick(next[0]) : allLabel && pick(ALL))}
      theme="app"
      mode={allLabel ? "single" : "radio"}
      className={cn("w-full sm:w-64", className)}
      // ≥44px on phones, the field's 40px from sm up.
      buttonClassName="h-11 sm:h-10"
    />
  );
}
