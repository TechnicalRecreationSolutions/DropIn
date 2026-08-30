import Link from "next/link";
import { Building2, Eye, EyeOff } from "lucide-react";
import OrgImage from "@/components/media/OrgImage";
import { cn } from "@/lib/utils/cn";

export interface FacilityCardPickerItem {
  id: string;
  name: string;
  city?: string | null;
  province?: string | null;
  is_published?: boolean;
  photo_urls?: string[] | null;
  /** A short, page-specific line of context — e.g. "3 departments". */
  meta?: string | null;
}

interface FacilityCardPickerProps {
  facilities: FacilityCardPickerItem[];
  activeFacilityId: string;
  hrefFor: (facilityId: string) => string;
}

/**
 * The big photo cards from the Facilities grid, reused as a filter: pick
 * which building's departments/schedules/sessions/spaces/map you're looking
 * at. Visually matches FacilityGridCard (same photo size, same badge) minus
 * the edit affordance, which belongs to facility management, not filtering.
 * Renders nothing for a single-facility org — there's nothing to switch
 * between, matching the tab-strip picker this replaces.
 */
export default function FacilityCardPicker({
  facilities,
  activeFacilityId,
  hrefFor,
}: FacilityCardPickerProps) {
  if (facilities.length < 2) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {facilities.map((facility) => {
        const active = facility.id === activeFacilityId;
        const coverPhoto = facility.photo_urls?.[0];

        return (
          <Link
            key={facility.id}
            href={hrefFor(facility.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "block rounded-xl border bg-white overflow-hidden transition-all",
              active
                ? "border-blue-400 shadow-md ring-1 ring-blue-100"
                : "border-gray-200 hover:border-blue-300 hover:shadow-sm"
            )}
          >
            <div className="relative h-28 bg-blue-50 flex items-center justify-center overflow-hidden">
              {coverPhoto ? (
                <OrgImage
                  src={coverPhoto}
                  alt=""
                  sizes="(max-width: 640px) 100vw, 320px"
                  className="object-contain"
                />
              ) : (
                <Building2 className="w-8 h-8 text-blue-300" />
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h3
                  className={cn(
                    "font-semibold truncate",
                    active ? "text-blue-700" : "text-gray-900"
                  )}
                >
                  {facility.name}
                </h3>
                {facility.is_published !== undefined &&
                  (facility.is_published ? (
                    <Eye className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />
                  ))}
              </div>
              {facility.city && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {facility.city}
                  {facility.province ? `, ${facility.province}` : ""}
                </p>
              )}
              {facility.meta && (
                <p className="text-xs text-gray-500 mt-3">{facility.meta}</p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
