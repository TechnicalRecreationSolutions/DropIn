"use client";

import { Eye, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ScheduleAudience } from "@/hooks/useScheduleRange";

interface AudienceToggleProps {
  value: ScheduleAudience;
  onChange: (next: ScheduleAudience) => void;
}

/**
 * Staff view ↔ Patron view.
 *
 * Not a "show internal sessions" checkbox, which is how this was first framed.
 * The two positions are two audiences, and the difference is fetched rather than
 * computed: Patron view re-requests the week with `audience=public`, so what
 * appears is the payload a patron would genuinely receive — withheld names
 * replaced, internal bookings gone, unapproved weeks hidden. A client-side
 * filter would be a second copy of those rules, and a preview that can drift
 * from what it previews is worse than none.
 *
 * Staff view is the default, and the toggle is per-browser rather than per-org:
 * it is a way of looking, not a setting anyone else should inherit.
 */
export default function AudienceToggle({ value, onChange }: AudienceToggleProps) {
  const options: { value: ScheduleAudience; label: string; icon: typeof Eye }[] = [
    { value: "staff", label: "Staff view", icon: Users },
    { value: "public", label: "Patron view", icon: Eye },
  ];

  return (
    <div
      className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
      role="group"
      aria-label="Whose version of the schedule to show"
    >
      {options.map((option) => {
        const selected = value === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
