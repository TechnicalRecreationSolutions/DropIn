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
 * editor and public view) — clicking one opens it for editing below. Sized
 * to match FacilityCardPicker's cards elsewhere, just with a floorplan
 * thumbnail standing in for the cover photo. Renders nothing for a
 * single-facility org, matching FacilityCardPicker.
 */
export default function FloorplanOverview({ facilities, activeFacilityId, hrefFor }: FloorplanOverviewProps) {
  if (facilities.length < 2) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {facilities.map((facility) => {
        const active = facility.id === activeFacilityId;
        return (
          <Link
            key={facility.id}
            href={hrefFor(facility.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group block rounded-xl border bg-white overflow-hidden transition-all",
              active
                ? "border-blue-400 shadow-md ring-1 ring-blue-100"
                : "border-gray-200 hover:border-blue-300 hover:shadow-sm"
            )}
          >
            <div className="relative h-28 overflow-hidden border-b border-gray-100 bg-[#F7F4EF]">
              {facility.map ? (
                <FacilityMapSvg
                  className="absolute inset-0 flex items-center justify-center"
                  canvasWidth={facility.map.canvasWidth}
                  canvasHeight={facility.map.canvasHeight}
                  shapes={facility.shapes}
                  contextElements={facility.contextElements}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <Building2 className="w-8 h-8 text-gray-300" />
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h3
                  className={cn(
                    "font-semibold truncate",
                    active ? "text-blue-700" : "text-gray-900 group-hover:text-gray-700"
                  )}
                >
                  {facility.name}
                </h3>
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded mt-0.5",
                    facility.map?.isPublished ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
                  )}
                >
                  {facility.map?.isPublished ? "Published" : "Draft"}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                {facility.spaceCount} space{facility.spaceCount === 1 ? "" : "s"}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
