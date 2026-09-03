import Link from "next/link";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { Building2, Eye, EyeOff, Layers, Calendar, Pencil } from "lucide-react";
import OrgImage from "@/components/media/OrgImage";

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
    <div
      className={`relative rounded-xl border bg-card overflow-hidden transition-all ${
        highlighted
          ? "border-blue-400 shadow-md"
          : "border-border hover:border-blue-300 hover:shadow-sm"
      }`}
    >
      <Link href={commandCentreHref({ facilityId: facility.id })} className="block">
        <div className="relative h-28 bg-blue-50 flex items-center justify-center overflow-hidden">
          {coverPhoto ? (
            <OrgImage src={coverPhoto} alt="" sizes="(max-width: 640px) 100vw, 320px" className="object-contain" />
          ) : (
            <Building2 className="w-8 h-8 text-blue-300" />
          )}
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-2 pr-7">
            <h3 className="font-semibold text-foreground truncate">{facility.name}</h3>
            {facility.is_published ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full shrink-0">
                <Eye className="w-3 h-3" /> Published
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                <EyeOff className="w-3 h-3" /> Draft
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {facility.city}, {facility.province}
          </p>
          <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
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
      <Link
        href={`/dashboard/facilities/${facility.id}/edit`}
        aria-label={`Edit ${facility.name}`}
        className="absolute top-4 right-4 p-1.5 rounded-lg bg-white/90 text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors shadow-sm"
      >
        <Pencil className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
