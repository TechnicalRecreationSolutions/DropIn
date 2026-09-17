import Link from "next/link";
import { Building2, EyeOff } from "lucide-react";
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
 * A compact pill row for picking which building's departments/schedules/
 * sessions/spaces you're looking at. Deliberately small: this is a filter,
 * not content — it used to reuse the full photo cards from the Facilities
 * grid, which pushed the actual page below the fold. The cover photo
 * survives as a tiny avatar, and the page-specific `meta` shows inside the
 * pill from `sm` up (and as a tooltip everywhere). Only unpublished
 * buildings get a status icon; published is the normal case. Scrolls
 * horizontally on narrow screens rather than wrapping into a tall block.
 * Pills rather than tabs so it doesn't read as the same level as the
 * DepartmentPicker tab strip that sits under it on the Sessions page.
 * Renders nothing for a single-facility org — there's nothing to switch
 * between.
 */
export default function FacilityCardPicker({
  facilities,
  activeFacilityId,
  hrefFor,
}: FacilityCardPickerProps) {
  if (facilities.length < 2) return null;

  return (
    <nav aria-label="Facility" className="-mx-1 overflow-x-auto">
      <ul className="flex items-center gap-2 px-1 py-0.5">
        {facilities.map((facility) => {
          const active = facility.id === activeFacilityId;
          const coverPhoto = facility.photo_urls?.[0];
          const location = [facility.city, facility.province].filter(Boolean).join(", ");
          const tooltip = [facility.name, location, facility.meta].filter(Boolean).join(" · ");

          return (
            <li key={facility.id} className="shrink-0">
              <Link
                href={hrefFor(facility.id)}
                aria-current={active ? "page" : undefined}
                title={tooltip}
                className={cn(
                  "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors whitespace-nowrap",
                  active
                    ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    : "border-border bg-card text-muted-foreground hover:border-blue-300 hover:text-foreground"
                )}
              >
                <span className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 dark:bg-blue-950/40">
                  {coverPhoto ? (
                    <OrgImage src={coverPhoto} alt="" sizes="24px" className="object-cover" />
                  ) : (
                    <Building2 className="h-3.5 w-3.5 text-blue-400" />
                  )}
                </span>
                <span className="font-medium">{facility.name}</span>
                {facility.meta && (
                  <span className="hidden text-xs text-muted-foreground sm:inline">{facility.meta}</span>
                )}
                {facility.is_published === false && (
                  <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-label="Not published" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
