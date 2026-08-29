"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, Plus, Pencil, Trash2, Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  is_published: boolean;
}

interface DepartmentsPanelProps {
  facility: { id: string; name: string };
  departments: DepartmentRow[];
}

/**
 * The dedicated Departments page's list — mirrors SpacesPanel's shape.
 * Departments no longer have a detail page of their own (that scope lives in
 * the schedule command centre), so this is the only place staff can rename,
 * publish, or delete one.
 */
export default function DepartmentsPanel({ facility, departments }: DepartmentsPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(department: DepartmentRow) {
    if (!confirm(`Delete "${department.name}"? Schedules in it keep their sessions but lose this grouping.`)) {
      return;
    }

    setError(null);
    setDeletingId(department.id);

    const res = await fetch(`/api/departments/${department.id}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not delete department.");
      setDeletingId(null);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["nav-tree"] });
    setDeletingId(null);
    router.refresh();
  }

  const newDepartmentHref = `/dashboard/facilities/${facility.id}/departments/new`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-500">
          Groups related schedules together in {facility.name} (e.g. Aquatics, Fitness).
        </p>
        <Link
          href={newDepartmentHref}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add department
        </Link>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      {departments.length === 0 ? (
        <div className="text-center py-14 bg-white rounded-xl border border-dashed border-gray-300">
          <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">No departments yet</h3>
          <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
            Add a department (e.g. &quot;Aquatics&quot;, &quot;Fitness&quot;) to group related
            schedules — optional, but useful once a building offers more than a few.
          </p>
          <Link
            href={newDepartmentHref}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add a department
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {departments.map((department) => (
            <div
              key={department.id}
              className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200"
            >
              <Layers className="w-4 h-4 text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{department.name}</p>
                {department.description && (
                  <p className="text-xs text-gray-500 truncate">{department.description}</p>
                )}
              </div>
              {department.is_published ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full shrink-0">
                  <Eye className="w-3 h-3" /> Published
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full shrink-0">
                  <EyeOff className="w-3 h-3" /> Draft
                </span>
              )}
              <Link
                href={`/dashboard/facilities/${facility.id}/departments/${department.id}/edit`}
                aria-label={`Edit ${department.name}`}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
              >
                <Pencil className="w-4 h-4" />
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(department)}
                disabled={deletingId === department.id}
                aria-label={`Delete ${department.name}`}
                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
