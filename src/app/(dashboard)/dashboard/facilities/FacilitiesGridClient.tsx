"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import dynamic from "next/dynamic";
import { LayoutGrid, Map as MapIcon } from "lucide-react";
import FacilityGridCard, { type FacilityGridItem } from "@/components/facilities/FacilityGridCard";

const FacilityMap = dynamic(() => import("@/components/discovery/FacilityMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm">
      Loading map…
    </div>
  ),
});

interface FacilityWithCoords extends FacilityGridItem {
  lat: number | null;
  lng: number | null;
  slug: string;
}

interface FacilitiesGridClientProps {
  facilities: FacilityWithCoords[];
}

export default function FacilitiesGridClient({ facilities }: FacilitiesGridClientProps) {
  const router = useRouter();
  const [view, setView] = useState<"grid" | "map">("grid");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleFacilityClick = useCallback(
    (slug: string) => {
      const facility = facilities.find((f) => f.slug === slug);
      if (facility) router.push(commandCentreHref({ facilityId: facility.id }));
    },
    [facilities, router]
  );

  const hasCoords = facilities.some((f) => f.lat != null && f.lng != null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setView("grid")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            view === "grid" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          Grid
        </button>
        <button
          onClick={() => setView("map")}
          disabled={!hasCoords}
          title={hasCoords ? undefined : "No facilities have a location set yet"}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            view === "map" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <MapIcon className="w-4 h-4" />
          Map
        </button>
      </div>

      {view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {facilities.map((facility) => (
            <div
              key={facility.id}
              onMouseEnter={() => setHoveredId(facility.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <FacilityGridCard facility={facility} highlighted={hoveredId === facility.id} />
            </div>
          ))}
        </div>
      ) : (
        <div className="h-[60vh] rounded-xl overflow-hidden border border-gray-200">
          <FacilityMap
            facilities={facilities}
            onFacilityHover={setHoveredId}
            onFacilityClick={handleFacilityClick}
          />
        </div>
      )}
    </div>
  );
}
