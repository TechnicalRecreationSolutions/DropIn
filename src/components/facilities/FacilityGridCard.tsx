import Link from "next/link";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { Building2, Eye, EyeOff, Layers, Calendar, Pencil } from "lucide-react";
import type { NoticeSeverity } from "@/types/app.types";
import OrgImage from "@/components/media/OrgImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FacilityStatusLink from "@/components/facilities/FacilityStatusLink";

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
      className={`relative rounded-card border bg-card overflow-hidden shadow-card transition-colors duration-150 ${
        highlighted
          ? "border-brand"
          : "border-border hover:border-input"
      }`}
    >
      <Link href={commandCentreHref({ facilityId: facility.id })} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <div className="relative h-28 bg-muted flex items-center justify-center overflow-hidden">
          {coverPhoto ? (
            <OrgImage src={coverPhoto} alt="" sizes="(max-width: 640px) 100vw, 320px" className="object-contain" />
          ) : (
            <Building2 className="w-8 h-8 text-muted-foreground" />
          )}
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-card-title text-foreground truncate">{facility.name}</h3>
            {facility.is_published ? (
              <Badge variant="success" className="shrink-0">
                <Eye className="w-3 h-3" /> Published
              </Badge>
            ) : (
              <Badge className="shrink-0">
                <EyeOff className="w-3 h-3" /> Draft
              </Badge>
            )}
          </div>
          <p className="text-caption text-muted-foreground mt-0.5">
            {facility.city}, {facility.province}
          </p>
          <div className="flex items-center gap-3 mt-3 text-caption text-muted-foreground">
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
      <FacilityStatusLink
        facilityId={facility.id}
        liveCount={facility.live_notice_count}
        worstSeverity={facility.worst_notice_severity}
        className="border-t border-border px-5 py-2.5"
      />

      <Button asChild variant="outline" size="icon-sm" className="absolute top-3 right-3 text-muted-foreground hover:text-foreground">
        <Link
          href={`/dashboard/facilities/${facility.id}/edit`}
          aria-label={`Edit ${facility.name}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Link>
      </Button>
    </div>
  );
}
