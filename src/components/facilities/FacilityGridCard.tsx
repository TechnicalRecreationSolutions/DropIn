import Link from "next/link";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { Building2, Eye, EyeOff, Layers, Calendar, Pencil, AlertOctagon, AlertTriangle, Megaphone } from "lucide-react";
import type { NoticeSeverity } from "@/types/app.types";
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
  /**
   * Live public notices on this facility (migration 060), and the worst
   * severity among them.
   *
   * On the FOOTER rather than beside the Published pill, because those two
   * badges answer different questions — "is this building's schedule live?" is
   * configuration, "is something wrong in it right now?" is today — and a
   * closure sitting next to a green Published chip reads as a contradiction.
   */
  live_notice_count: number;
  worst_notice_severity: NoticeSeverity | null;
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
      {/* Outside the big Link — a nested anchor is invalid HTML and the
          browser resolves it by dropping one of them, usually this one. */}
      <Link
        href={`/dashboard/facilities/${facility.id}/status`}
        className={`flex items-center gap-2 border-t px-4 py-2.5 text-xs font-medium transition-colors ${
          facility.worst_notice_severity === "closure"
            ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
            : facility.worst_notice_severity
              ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              : "border-border text-muted-foreground hover:bg-muted"
        }`}
      >
        {facility.worst_notice_severity === "closure" ? (
          <AlertOctagon className="size-3.5 shrink-0" aria-hidden />
        ) : facility.worst_notice_severity ? (
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <Megaphone className="size-3.5 shrink-0" aria-hidden />
        )}
        {facility.live_notice_count === 0
          ? "Post a status"
          : facility.live_notice_count === 1
            ? "1 status is live"
            : `${facility.live_notice_count} statuses are live`}
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
