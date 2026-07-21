"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Search, SlidersHorizontal } from "lucide-react";
import FacilityCard, { type FacilityCardData } from "@/components/discovery/FacilityCard";
import type { SportCategory } from "@/lib/utils/sport-categories";

// Dynamically import the map — Mapbox requires browser APIs
const FacilityMap = dynamic(() => import("@/components/discovery/FacilityMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm">
      Loading map…
    </div>
  ),
});

interface FacilityWithCoords extends FacilityCardData {
  lat: number | null;
  lng: number | null;
}

interface SearchPageClientProps {
  initialFacilities: FacilityWithCoords[];
  initialQuery: string;
  initialSport: string;
  initialCity: string;
  sportCategories: SportCategory[];
}

export default function SearchPageClient({
  initialFacilities,
  initialQuery,
  initialSport,
  initialCity,
  sportCategories,
}: SearchPageClientProps) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [sport, setSport] = useState(initialSport);
  const [city, setCity] = useState(initialCity);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  function applyFilters() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sport) params.set("sport", sport);
    if (city) params.set("city", city);
    router.push(`/search?${params.toString()}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") applyFilters();
  }

  const handleFacilityClick = useCallback((slug: string) => {
    router.push(`/facility/${slug}`);
  }, [router]);

  const facilities = initialFacilities;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Search bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex gap-2 items-center">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search facilities…"
              className="flex-1 text-sm outline-none bg-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              showFilters || sport || city
                ? "bg-blue-50 border-blue-300 text-blue-700"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {(sport || city) && (
              <span className="w-2 h-2 rounded-full bg-blue-500" />
            )}
          </button>
          <button
            onClick={applyFilters}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Search
          </button>
        </div>

        {/* Filter drawer */}
        {showFilters && (
          <div className="max-w-7xl mx-auto mt-3 flex flex-wrap gap-3">
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All sports</option>
              {sportCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.icon} {cat.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="City"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
            />
            {(sport || city) && (
              <button
                onClick={() => { setSport(""); setCity(""); }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Map + list split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Facility list — scrollable */}
        <div className="w-full sm:w-[380px] lg:w-[420px] flex-shrink-0 overflow-y-auto bg-gray-50 border-r border-gray-200">
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-500 font-medium">
              {facilities.length} facilit{facilities.length !== 1 ? "ies" : "y"} found
            </p>
            {facilities.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="font-medium text-sm">No facilities found</p>
                <p className="text-xs mt-1">Try a different search or remove filters.</p>
              </div>
            ) : (
              facilities.map((facility) => (
                <div
                  key={facility.id}
                  onMouseEnter={() => setHoveredId(facility.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <FacilityCard
                    facility={facility}
                    highlighted={hoveredId === facility.id}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Map — hidden on mobile, visible sm+ */}
        <div className="hidden sm:flex flex-1 p-3">
          <FacilityMap
            facilities={facilities}
            onFacilityHover={setHoveredId}
            onFacilityClick={handleFacilityClick}
          />
        </div>
      </div>
    </div>
  );
}
