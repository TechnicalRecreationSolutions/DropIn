import Link from "next/link";
import { cn } from "@/lib/utils/cn";

interface FacilityPickerProps {
  facilities: { id: string; name: string }[];
  activeFacilityId: string;
  hrefFor: (facilityId: string) => string;
}

/**
 * A row of building links, styled like the old command-centre tab strip.
 * Renders nothing for a single-facility org — there's nothing to switch
 * between.
 */
export default function FacilityPicker({ facilities, activeFacilityId, hrefFor }: FacilityPickerProps) {
  if (facilities.length < 2) return null;

  return (
    <div className="border-b border-gray-200">
      <div className="flex gap-1 overflow-x-auto">
        {facilities.map((f) => {
          const active = f.id === activeFacilityId;
          return (
            <Link
              key={f.id}
              href={hrefFor(f.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                active
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              )}
            >
              {f.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
