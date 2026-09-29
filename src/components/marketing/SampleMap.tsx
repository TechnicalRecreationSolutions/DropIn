"use client";

import FacilityMapSvg from "@/components/facility-maps/renderer/FacilityMapSvg";
import { cn } from "@/lib/utils/cn";
import { statusMapFor, type SampleFacility, type SampleMoment } from "./sampleFacilities";

/**
 * One sample building at one moment: the product's own map renderer, with the
 * same information underneath as text.
 *
 * The text list is not decoration. The renderer drops lane and status text
 * before it would smudge (see renderer/README.md), so on a phone the map is
 * colour and shape only — the list is what says "Lanes 1–3, Reserved" at that
 * width, and it is what a screen reader gets at any width.
 *
 * The map is inert (no `onSpaceClick`): tapping a space opens a sheet in the
 * product, and a sample with nothing behind the tap would be a dead control.
 */
export default function SampleMap({
  facility,
  moment,
  className,
}: {
  facility: SampleFacility;
  moment: SampleMoment;
  className?: string;
}) {
  return (
    <figure className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <FacilityMapSvg
        canvasWidth={facility.canvasWidth}
        canvasHeight={facility.canvasHeight}
        shapes={facility.shapes}
        statusBySpaceId={statusMapFor(moment)}
      />
      <figcaption className="border-t border-border px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {facility.name} · {moment.label}
        </p>
        <ul className="mt-2 space-y-1.5">
          {moment.entries.map((entry) => (
            <li key={entry.where} className="flex items-baseline gap-2 text-sm">
              <span className="w-24 shrink-0 font-medium text-foreground">{entry.where}</span>
              <span className="min-w-0 text-muted-foreground">
                <span className="text-foreground">{entry.title}</span>, {entry.timeLabel}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
