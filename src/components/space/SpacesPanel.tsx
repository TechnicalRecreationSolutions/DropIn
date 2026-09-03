"use client";

import Link from "next/link";
import { MapPin, Plus, Pencil, Eye, EyeOff } from "lucide-react";
import { NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";
import type { CommandSpace } from "@/components/schedule-command/types";

interface SpacesPanelProps {
  /** Only the fields this panel actually reads — a full `CommandFacility` satisfies this too. */
  facility: { id: string; name: string; spaces: CommandSpace[] };
  /** A real department id, NO_DEPARTMENT, or null for the whole building. */
  departmentId: string | null;
  departmentLabel: string | null;
}

/**
 * The bookable locations sessions attach to — lanes, courts, studios.
 * Backs the dedicated Spaces page (`/dashboard/spaces/page.tsx`) — it used
 * to also render inline as a command-centre tab, but Spaces, Map, and
 * Widget each moved to their own top-level route.
 */
export default function SpacesPanel({ facility, departmentId, departmentLabel }: SpacesPanelProps) {
  const realDepartmentId = departmentId && departmentId !== NO_DEPARTMENT ? departmentId : null;

  const spaces = facility.spaces.filter((s) => {
    if (departmentId === null) return true;
    if (departmentId === NO_DEPARTMENT) return !s.departmentId;
    return s.departmentId === departmentId;
  });

  const newSpaceHref = realDepartmentId
    ? `/dashboard/facilities/${facility.id}/spaces/new?departmentId=${realDepartmentId}`
    : `/dashboard/facilities/${facility.id}/spaces/new`;

  const scopeLabel = departmentLabel ?? facility.name;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Bookable locations in {scopeLabel} that sessions can be placed into.
        </p>
        <Link
          href={newSpaceHref}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add space
        </Link>
      </div>

      {spaces.length === 0 ? (
        <div className="text-center py-14 bg-card rounded-xl border border-dashed border-border">
          <MapPin className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
          <h3 className="font-medium text-foreground mb-1">No spaces yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Add a space (e.g. &quot;Lane 3&quot;, &quot;Court A&quot;) to give sessions a specific
            location — the Map view and floorplan both build on these.
          </p>
          <Link
            href={newSpaceHref}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add a space
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {spaces.map((space) => (
            <div
              key={space.id}
              className="flex items-center gap-3 p-4 bg-card rounded-xl border border-border"
            >
              <MapPin className="w-4 h-4 text-muted-foreground/70 shrink-0" />
              <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                {space.name}
              </span>
              {space.capacity != null && (
                <span className="text-xs text-muted-foreground/70 shrink-0">Cap. {space.capacity}</span>
              )}
              {space.isPublished ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full shrink-0">
                  <Eye className="w-3 h-3" /> Published
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full shrink-0">
                  <EyeOff className="w-3 h-3" /> Draft
                </span>
              )}
              <Link
                href={`/dashboard/facilities/${facility.id}/spaces/${space.id}/edit`}
                aria-label={`Edit ${space.name}`}
                className="p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <Pencil className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
