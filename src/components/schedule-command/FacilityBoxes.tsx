"use client";

import Link from "next/link";
import { Building2, Plus, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { CommandFacility } from "./types";

interface FacilityBoxesProps {
  facilities: CommandFacility[];
  selectedFacilityId: string | null;
  onSelect: (facilityId: string) => void;
}

/**
 * The command centre's top row: one large box per building, matching the
 * overview's Quick build tiles so the two read as the same control. Picking
 * a box swaps the whole editor below it — no navigation, no page load — so
 * an admin who works in one facility all afternoon never leaves this page.
 *
 * Mobile-first: two columns on a phone, widening with the viewport, and the
 * row stays visible so switching buildings is always one tap away.
 */
export default function FacilityBoxes({
  facilities,
  selectedFacilityId,
  onSelect,
}: FacilityBoxesProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {facilities.map((facility) => {
        const selected = facility.id === selectedFacilityId;
        const scheduleCount = facility.scheduleGroups.length;

        return (
          <button
            key={facility.id}
            type="button"
            onClick={() => onSelect(facility.id)}
            aria-pressed={selected}
            className={cn(
              "flex flex-col items-center justify-center gap-2 p-4 min-h-[7rem] rounded-xl border text-center transition-all",
              selected
                ? "border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500"
                : "border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm"
            )}
          >
            <span
              className={cn(
                "relative w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                selected ? "bg-blue-600" : "bg-blue-50"
              )}
            >
              <Building2 className={cn("w-4 h-4", selected ? "text-white" : "text-blue-600")} />
              {!facility.isPublished && (
                <EyeOff
                  className="w-3 h-3 text-amber-600 absolute -right-1 -bottom-1 bg-white rounded-full border border-amber-100 p-0.5 box-content"
                  aria-label="Unpublished"
                />
              )}
            </span>
            <span className="text-xs font-semibold text-gray-900 line-clamp-2">{facility.name}</span>
            <span className="text-[11px] text-gray-500">
              {scheduleCount === 0
                ? "No schedules"
                : `${scheduleCount} schedule${scheduleCount === 1 ? "" : "s"}`}
            </span>
          </button>
        );
      })}

      <Link
        href="/dashboard/facilities/new"
        className="flex flex-col items-center justify-center gap-2 p-4 min-h-[7rem] rounded-xl border border-dashed border-gray-300 bg-white text-center hover:border-blue-300 hover:shadow-sm transition-all"
      >
        <span className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center">
          <Plus className="w-4 h-4 text-gray-500" />
        </span>
        <span className="text-xs font-medium text-gray-600">Add facility</span>
      </Link>
    </div>
  );
}
