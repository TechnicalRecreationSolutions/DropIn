import Link from "next/link";
import { MapPin } from "lucide-react";
import { getSportCategory } from "@/lib/utils/sport-categories";

export interface FacilityCardData {
  id: string;
  name: string;
  slug: string;
  city: string;
  province: string;
  description: string | null;
  sport_categories: string[]; // distinct sport categories across published schedules
  schedule_count: number;
}

interface FacilityCardProps {
  facility: FacilityCardData;
  /** Highlight this card (e.g. hovered pin on map) */
  highlighted?: boolean;
}

export default function FacilityCard({ facility, highlighted }: FacilityCardProps) {
  const topSports = facility.sport_categories.slice(0, 4);

  return (
    <Link
      href={`/facility/${facility.slug}`}
      className={`block p-4 rounded-xl border transition-all ${
        highlighted
          ? "border-blue-400 shadow-md bg-blue-50"
          : "border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{facility.name}</h3>
          <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
            <MapPin className="w-3 h-3 shrink-0" />
            <span>{facility.city}, {facility.province}</span>
          </div>
        </div>
        <span className="shrink-0 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          {facility.schedule_count} schedule{facility.schedule_count !== 1 ? "s" : ""}
        </span>
      </div>

      {facility.description && (
        <p className="text-xs text-gray-500 mt-2 line-clamp-2">{facility.description}</p>
      )}

      {topSports.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {topSports.map((sportId) => {
            const sport = getSportCategory(sportId);
            return (
              <span
                key={sportId}
                className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full"
              >
                {sport?.icon} {sport?.label ?? sportId}
              </span>
            );
          })}
          {facility.sport_categories.length > 4 && (
            <span className="text-xs text-gray-400 px-2 py-0.5">
              +{facility.sport_categories.length - 4} more
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
