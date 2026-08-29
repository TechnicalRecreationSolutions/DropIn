import Link from "next/link";
import { Building2 } from "lucide-react";
import FacilityMapSvg from "./renderer/FacilityMapSvg";
import type { RenderShape, RenderContextElement } from "./renderer/types";
import { cn } from "@/lib/utils/cn";

export interface FloorplanOverviewFacility {
  id: string;
  name: string;
  spaceCount: number;
  map: { canvasWidth: number; canvasHeight: number; isPublished: boolean } | null;
  shapes: RenderShape[];
  contextElements: RenderContextElement[];
}

interface FloorplanOverviewProps {
  facilities: FloorplanOverviewFacility[];
  activeFacilityId: string;
  hrefFor: (facilityId: string) => string;
}

/**
 * Every building's floor plan at a glance, so switching from the old
 * tab-strip picker doesn't cost the ability to see more than one building
 * at a time. Each card is a small read-only render (same engine as the
 * editor and public view) — clicking one opens it for editing below.
 * Renders nothing for a single-facility org, matching FacilityPicker.
 * Capped to the same content width as the editor below so the page reads
 * as one column instead of a small grid floating in a much wider area.
 */
export default function FloorplanOverview({ facilities, activeFacilityId, hrefFor }: FloorplanOverviewProps) {
  if (facilities.length < 2) return null;

  return (
    <div className="max-w-[1000px] mx-auto">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Your buildings</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {facilities.map((facility) => {
          const active = facility.id === activeFacilityId;
          return (
            <Link
              key={facility.id}
              href={hrefFor(facility.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group rounded-xl border bg-white p-2.5 transition-colors",
                active ? "border-blue-600 ring-1 ring-blue-600" : "border-gray-200 hover:border-gray-300"
              )}
            >
              <div className="rounded-lg overflow-hidden border border-gray-100 bg-[#F7F4EF]">
                {facility.map ? (
                  <FacilityMapSvg
                    canvasWidth={facility.map.canvasWidth}
                    canvasHeight={facility.map.canvasHeight}
                    shapes={facility.shapes}
                    contextElements={facility.contextElements}
                  />
                ) : (
                  <div className="aspect-[4/3] flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-gray-300" />
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-start justify-between gap-2">
                <p
                  className={cn(
                    "text-sm font-medium truncate",
                    active ? "text-blue-600" : "text-gray-900 group-hover:text-gray-700"
                  )}
                >
                  {facility.name}
                </p>
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded",
                    facility.map?.isPublished ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
                  )}
                >
                  {facility.map?.isPublished ? "Published" : "Draft"}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {facility.spaceCount} space{facility.spaceCount === 1 ? "" : "s"}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
