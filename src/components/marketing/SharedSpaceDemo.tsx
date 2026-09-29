"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import SampleMap from "./SampleMap";
import { SAMPLE_POOL, SAMPLE_COURTS } from "./sampleFacilities";

/**
 * A pool and a gym floor side by side, at three moments in one day.
 *
 * The chips stand in for the floorplan's time control, which lets a visitor
 * look at any other time today. Three fixed moments rather than a slider
 * because the sample has no schedule behind it to interpolate — every state
 * shown is one that was written down.
 */
export default function SharedSpaceDemo() {
  const [index, setIndex] = useState(0);
  const times = SAMPLE_POOL.moments.map((m) => m.label);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <span className="text-sm font-medium text-foreground">Look at</span>
        <div
          role="group"
          aria-label="Time of day"
          className="inline-flex items-center gap-1 rounded-lg bg-card border border-border p-1"
        >
          {times.map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={index === i}
              onClick={() => setIndex(i)}
              className={cn(
                "px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors tabular-nums",
                index === i
                  ? "bg-blue-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SampleMap facility={SAMPLE_POOL} moment={SAMPLE_POOL.moments[index]} />
        <SampleMap facility={SAMPLE_COURTS} moment={SAMPLE_COURTS.moments[index]} />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Sample buildings with sample sessions, drawn by Dropin&rsquo;s own map. With the
        floorplan view turned on, patrons tap a space to see what&rsquo;s on and
        what&rsquo;s next there.
      </p>
    </div>
  );
}
