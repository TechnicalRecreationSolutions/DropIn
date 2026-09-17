"use client";

import { Printer } from "lucide-react";
import { cn } from "@/lib/utils/cn";

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
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
      <span className="inline-flex items-center justify-center size-8 rounded-lg shrink-0 bg-muted text-muted-foreground">
        <Printer className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <span id="widget-allow-print-label" className="block text-sm font-medium text-foreground">
          Print button
        </span>
        <p className="text-xs text-muted-foreground leading-snug">
          Visitors can print the week they&rsquo;re looking at, with their filters applied. Every
          printout says the schedule is subject to change, shows when it was printed, and
          notes when filters have left sessions out.
        </p>
        {unavailable && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
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
          "relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
          value ? "bg-blue-600" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "inline-block size-5 rounded-full bg-white shadow transition-transform",
            value ? "translate-x-5" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
