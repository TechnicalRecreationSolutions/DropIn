"use client";

import { InfoTip } from "@/components/ui/info-tip";
import { Segmented } from "@/components/ui/segmented";

interface FiltersStartToggleProps {
  /** true = starts collapsed. */
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** The database doesn't have `widget_configs.filters_collapsed` yet (migration 066). */
  unavailable?: boolean;
  /** Every visitor filter is switched off above, so there is no section to fold. */
  noFilters?: boolean;
}

/**
 * How the visitor filter section starts (`widget_configs.filters_collapsed`).
 * Visitors can fold it away or open it either way — the section always has its
 * "Filters" toggle (ScheduleFilterBar) — so this only picks the first look.
 *
 * Two named choices rather than an on/off switch: "collapsed: off" makes the
 * admin translate a negative, and the real question is "what do visitors see
 * first". Sits right under VisitorFilterToggles because it is about the
 * section those toggles fill.
 */
export default function FiltersStartToggle({ value, onChange, disabled, unavailable, noFilters }: FiltersStartToggleProps) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border px-3 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-body font-medium text-foreground">Filter section starts</span>
          <InfoTip>
            Visitors can open or hide the filters with the &ldquo;Filters&rdquo; toggle either way. Collapsed keeps
            the widget short, which helps on phones; a collapsed section still shows how many filters are on.
          </InfoTip>
        </div>
        <p className="text-caption text-muted-foreground">
          {noFilters ? "Turn on a filter above to use this." : "What visitors see before they touch anything."}
        </p>
        {unavailable && (
          <p className="mt-1 text-caption text-warning">
            Not available yet: database migration 066 hasn&rsquo;t been applied.
          </p>
        )}
      </div>
      <Segmented
        label="Filter section starts"
        value={value ? "collapsed" : "open"}
        onChange={(next) => onChange(next === "collapsed")}
        disabled={disabled}
        options={[
          { value: "open", label: "Open" },
          { value: "collapsed", label: "Collapsed" },
        ]}
      />
    </div>
  );
}
