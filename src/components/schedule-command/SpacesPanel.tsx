"use client";

import Link from "next/link";
import { MapPin, Plus, Pencil, Eye, EyeOff } from "lucide-react";
import { NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";
import type { CommandFacility } from "./types";

interface SpacesPanelProps {
  facility: CommandFacility;
  /** A real department id, NO_DEPARTMENT, or null for the whole building. */
  departmentId: string | null;
  departmentLabel: string | null;
}

/**
 * The bookable locations sessions attach to — lanes, courts, studios.
 *
 * Lives here rather than on its own page because spaces and sessions are
 * the same job: you add Lane 7 *because* you're about to schedule something
 * in it, and the Map and Schedule tabs both drop straight onto spaces. The
 * list follows the scope above it, so picking a department shows that
 * department's spaces and creates new ones inside it.
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
        <p className="text-sm text-gray-500">
          Bookable locations in {scopeLabel} that sessions can be placed into.
        </p>
        <Link
          href={newSpaceHref}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add space
        </Link>
      </div>

      {spaces.length === 0 ? (
        <div className="text-center py-14 bg-white rounded-xl border border-dashed border-gray-300">
          <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">No spaces yet</h3>
          <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
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
              className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200"
            >
              <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm font-medium text-gray-900 flex-1 min-w-0 truncate">
                {space.name}
              </span>
              {space.capacity != null && (
                <span className="text-xs text-gray-400 shrink-0">Cap. {space.capacity}</span>
              )}
              {space.isPublished ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full shrink-0">
                  <Eye className="w-3 h-3" /> Published
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full shrink-0">
                  <EyeOff className="w-3 h-3" /> Draft
                </span>
              )}
              <Link
                href={`/dashboard/facilities/${facility.id}/spaces/${space.id}/edit`}
                aria-label={`Edit ${space.name}`}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
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
