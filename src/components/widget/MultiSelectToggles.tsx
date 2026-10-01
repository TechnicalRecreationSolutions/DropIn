"use client";

import { InfoTip } from "@/components/ui/info-tip";
import type { ScopeLevel } from "@/lib/schedule/scopeSelection";

interface MultiSelectTogglesProps {
  value: ScopeLevel[];
  onChange: (next: ScopeLevel[]) => void;
  disabled?: boolean;
  /** The database doesn't have `widget_configs.multi_select_levels` yet (migration 065). */
  unavailable?: boolean;
}

const LEVELS: { key: ScopeLevel; label: string }[] = [
  { key: "facility", label: "Facilities" },
  { key: "department", label: "Departments" },
  { key: "schedule", label: "Schedules" },
];

/**
 * Where visitors may tick several in the widget's Facility / Department /
 * Schedule switcher (`widget_configs.multi_select_levels`). Off, a level takes
 * one at a time; either way nothing ticked means "All …". Matters only when
 * the Schedules section gives the switcher more than one schedule.
 *
 * Not to be confused with the Activity and Where filters: those already let
 * visitors tick several, always, and have no setting for it.
 */
export default function MultiSelectToggles({ value, onChange, disabled, unavailable }: MultiSelectTogglesProps) {
  function toggle(key: ScopeLevel) {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  return (
    <div className="rounded-card border border-border px-3 py-3">
      <div className="flex items-center gap-1.5">
        <span id="widget-multi-select-label" className="text-body font-medium text-foreground">
          Let visitors pick several
        </span>
        <InfoTip>
          In the Facility, Department and Schedule menus at the top of the widget. Off, visitors pick one at a time.
          Either way, leaving a menu empty shows everything in it.
        </InfoTip>
      </div>
      <p className="text-caption text-muted-foreground">In the switcher menus at the top of the widget.</p>
      <div role="group" aria-labelledby="widget-multi-select-label" className="mt-1 flex flex-wrap gap-x-5">
        {LEVELS.map(({ key, label }) => (
          <label key={key} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-body text-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            <input
              type="checkbox"
              checked={value.includes(key)}
              onChange={() => toggle(key)}
              disabled={disabled}
              className="size-4 rounded-sm border-input accent-primary"
            />
            {label}
          </label>
        ))}
      </div>
      {unavailable && (
        <p className="text-caption text-warning">
          Not available yet: database migration 065 hasn&rsquo;t been applied.
        </p>
      )}
    </div>
  );
}
