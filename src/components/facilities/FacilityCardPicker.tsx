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
                  "flex min-h-11 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm sm:min-h-8 transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-brand bg-brand-subtle text-brand-strong"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <span className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                  {coverPhoto ? (
                    <OrgImage src={coverPhoto} alt="" sizes="24px" className="object-cover" />
                  ) : (
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </span>
                <span className="font-medium">{facility.name}</span>
                {facility.meta && (
                  <span className={cn("hidden text-xs sm:inline", active ? "text-primary-foreground/75" : "text-muted-foreground")}>{facility.meta}</span>
                )}
                {facility.is_published === false && (
                  <EyeOff className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary-foreground/75" : "text-muted-foreground")} aria-label="Not published" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
