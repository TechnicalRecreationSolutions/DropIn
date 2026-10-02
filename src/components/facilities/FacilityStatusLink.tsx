import Link from "next/link";
import { AlertOctagon, AlertTriangle, Megaphone } from "lucide-react";
import type { NoticeSeverity } from "@/types/app.types";
import { cn } from "@/lib/utils/cn";

interface FacilityStatusLinkProps {
  facilityId: string;
  /** Live public notices on the facility (migration 060). */
  liveCount: number;
  worstSeverity: NoticeSeverity | null;
  className?: string;
}

/**
 * "Post a status", or how many are live — one line, coloured by the worst
 * live notice. Shared by the facilities grid card and the map page's list and
 * card, so the three cannot describe a building's day differently.
 *
 * Kept apart from the Published badge on purpose: "is this building's
 * schedule live?" is configuration, "is something wrong in it right now?" is
 * today, and a closure beside a green Published chip reads as a contradiction.
 */
export default function FacilityStatusLink({
  facilityId,
  liveCount,
  worstSeverity,
  className,
}: FacilityStatusLinkProps) {
  return (
    <Link
      href={`/dashboard/facilities/${facilityId}/status`}
      className={cn(
        "flex items-center gap-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        worstSeverity === "closure"
          ? "bg-destructive-subtle text-destructive hover:underline"
          : worstSeverity
            ? "bg-warning-subtle text-warning hover:underline"
            : "text-muted-foreground hover:bg-muted",
        className
      )}
    >
      {worstSeverity === "closure" ? (
        <AlertOctagon className="size-3.5 shrink-0" aria-hidden />
      ) : worstSeverity ? (
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <Megaphone className="size-3.5 shrink-0" aria-hidden />
      )}
      {liveCount === 0
        ? "Post a status"
        : liveCount === 1
          ? "1 status is live"
          : `${liveCount} statuses are live`}
    </Link>
  );
}
