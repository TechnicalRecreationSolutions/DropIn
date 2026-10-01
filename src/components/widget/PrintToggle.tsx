"use client";

import { InfoTip } from "@/components/ui/info-tip";
import { Switch } from "@/components/ui/switch";

interface PrintToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** The database doesn't have `widget_configs.allow_print` yet (migration 051). */
  unavailable?: boolean;
}

/**
 * Whether visitors get a Print button (`widget_configs.allow_print`).
 *
 * Lives in Visitor tools beside the filters because the two are one feature
 * from the visitor's side: what prints is the week *after* their filters, see
 * `components/schedule/PrintableSchedule.tsx`. The tip says what the printout
 * carries, since an admin's real question is "will people think a stale sheet
 * is current?"
 */
export default function PrintToggle({ value, onChange, disabled, unavailable }: PrintToggleProps) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-border px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span id="widget-allow-print-label" className="text-body font-medium text-foreground">
            Print button
          </span>
          <InfoTip>
            Every printout says the schedule is subject to change, shows when it was printed, and
            notes when filters have left sessions out.
          </InfoTip>
        </div>
        <p className="text-caption text-muted-foreground">
          Visitors can print the week they&rsquo;re viewing.
        </p>
        {unavailable && (
          <p className="mt-1 text-caption text-warning">
            Not available yet: database migration 051 hasn&rsquo;t been applied.
          </p>
        )}
      </div>
      <Switch
        checked={value}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby="widget-allow-print-label"
      />
    </div>
  );
}
