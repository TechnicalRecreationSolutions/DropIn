"use client";

import { Printer } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { InfoTip } from "@/components/ui/info-tip";

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
 * Lives in step 3 beside the filters because the two are one feature from the
 * visitor's side: what prints is the week *after* their filters, see
 * `components/schedule/PrintableSchedule.tsx`. The blurb says what the printout
 * carries, since an admin's real question is "will people think a stale sheet
 * is current?"
 */
export default function PrintToggle({ value, onChange, disabled, unavailable }: PrintToggleProps) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-border bg-card p-4">
      <Printer aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
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
            Not available yet — database migration 051 hasn&rsquo;t been applied.
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-labelledby="widget-allow-print-label"
        onClick={() => onChange(!value)}
        disabled={disabled}
        className={cn(
          "relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
          value ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "inline-block size-5 rounded-full bg-background shadow-card transition-transform",
            value ? "translate-x-5" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
