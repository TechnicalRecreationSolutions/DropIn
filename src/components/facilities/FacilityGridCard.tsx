import Link from "next/link";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { Building2, Eye, EyeOff, Layers, Calendar } from "lucide-react";

export interface FacilityGridItem {
  id: string;
  name: string;
  city: string;
  province: string;
  is_published: boolean;
  photo_urls: string[];
  department_count: number;
  schedule_count: number;
}

interface FacilityGridCardProps {
  facility: FacilityGridItem;
  highlighted?: boolean;
}

export default function FacilityGridCard({ facility, highlighted }: FacilityGridCardProps) {
  const coverPhoto = facility.photo_urls[0];

  return (
    <Link
      href={commandCentreHref({ facilityId: facility.id })}
      className={`block rounded-xl border bg-white overflow-hidden transition-all ${
        highlighted
          ? "border-blue-400 shadow-md"
          : "border-gray-200 hover:border-blue-300 hover:shadow-sm"
      }`}
    >
      <div className="h-28 bg-blue-50 flex items-center justify-center overflow-hidden">
        {coverPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverPhoto} alt="" className="w-full h-full object-cover" />
        ) : (
          <Building2 className="w-8 h-8 text-blue-300" />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 truncate">{facility.name}</h3>
          {facility.is_published ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full shrink-0">
              <Eye className="w-3 h-3" /> Published
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
              <EyeOff className="w-3 h-3" /> Draft
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {facility.city}, {facility.province}
        </p>
        <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" />
            {facility.department_count} department{facility.department_count !== 1 ? "s" : ""}
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {facility.schedule_count} schedule{facility.schedule_count !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </Link>
  );
}
