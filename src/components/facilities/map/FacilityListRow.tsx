import type { Ref } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import FacilityMark from "./FacilityMark";
import FacilityActions from "./FacilityActions";
import { LOCATION_COPY, countsLine, type FacilityMapItem } from "./types";

interface FacilityListRowProps {
  facility: FacilityMapItem;
  selected: boolean;
  /** Outside the map's opening view — reachable from its off-map chip. */
  offMap: boolean;
  /** Show the actions under the row (phones, and when there is no map card). */
  expanded: boolean;
  onSelect(): void;
  onHover(over: boolean): void;
  ref?: Ref<HTMLDivElement>;
}

/**
 * One facility in the list — the accessible equivalent of its pin: selecting
 * the row selects the pin and moves the map to it. The row itself is a real
 * button; the actions it reveals sit beside it, not inside it, because links
 * inside a button are invalid HTML.
 */
export default function FacilityListRow({
  facility,
  selected,
  offMap,
  expanded,
  onSelect,
  onHover,
  ref,
}: FacilityListRowProps) {
  const unplaced = facility.locationState !== "located";
  return (
    <div ref={ref} className={cn("scroll-my-2", selected && "bg-brand-subtle")}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        className={cn(
          "flex min-h-16 w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:px-5",
          !selected && "hover:bg-muted"
        )}
      >
        <FacilityMark
          name={facility.name}
          photoUrl={facility.photo_urls[0] ?? null}
          selected={selected}
          unplaced={unplaced}
          className="mt-0.5"
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-semibold",
              selected ? "text-brand-strong" : "text-foreground"
            )}
          >
            {facility.name}
          </span>
          <span className="block truncate text-caption text-muted-foreground">
            {facility.city}, {facility.province}
            {offMap && " · off this map"}
          </span>
          <span className="block truncate text-caption text-muted-foreground">
            {unplaced ? LOCATION_COPY[facility.locationState as "pending" | "not_found"] : countsLine(facility)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          {facility.is_published ? <Badge variant="success">Published</Badge> : <Badge>Draft</Badge>}
          {facility.live_notice_count > 0 && (
            <Badge variant={facility.worst_notice_severity === "closure" ? "destructive" : "warning"}>
              {facility.live_notice_count} live
            </Badge>
          )}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pl-14 lg:px-5 lg:pl-15">
          {unplaced && <p className="mb-2 text-caption text-muted-foreground">{countsLine(facility)}</p>}
          <FacilityActions facility={facility} />
        </div>
      )}
    </div>
  );
}
