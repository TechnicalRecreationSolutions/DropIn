"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { departmentsHref } from "@/lib/schedule/commandCentreHref";
import { useQueryClient } from "@tanstack/react-query";

interface FacilityOption {
  id: string;
  name: string;
}

interface DepartmentFormProps {
  /** Fixed when created from a facility's page; otherwise staff must pick one. */
  facilityId?: string;
  /** Required when facilityId is not fixed, so staff can choose which facility this department belongs to. */
  facilities?: FacilityOption[];
  departmentId?: string;
  defaultValues?: {
    name?: string;
    description?: string;
    is_published?: boolean;
  };
  /** Where to send staff after a successful save. Defaults to the Departments page for the created department's facility. */
  redirectTo?: string;
}

export default function DepartmentForm({
  facilityId: fixedFacilityId,
  facilities,
  departmentId,
  defaultValues,
  redirectTo,
}: DepartmentFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!departmentId;

  const [form, setForm] = useState({
    facility_id: fixedFacilityId ?? "",
    name: defaultValues?.name ?? "",
    description: defaultValues?.description ?? "",
    is_published: defaultValues?.is_published ?? false,
  });

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const facilityId = fixedFacilityId ?? form.facility_id;
    if (!facilityId) {
      setError("Please select a facility.");
      return;
    }

    setLoading(true);

    const res = await fetch(
      isEditing ? `/api/departments/${departmentId}` : "/api/departments",
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facility_id: facilityId,
          name: form.name,
          description: form.description || null,
          is_published: form.is_published,
        }),
      }
    );

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["nav-tree"] });
    router.push(redirectTo ?? departmentsHref(facilityId));
    router.refresh();
  }

  const fieldClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
      {!fixedFacilityId && (
        <div>
          <label htmlFor="facility_id" className={labelClass}>Facility *</label>
          <select
            id="facility_id"
            name="facility_id"
            required
            value={form.facility_id}
            onChange={handleChange}
            className={fieldClass}
          >
            <option value="" disabled>Select a facility…</option>
            {(facilities ?? []).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="name" className={labelClass}>Department name *</label>
        <input
          id="name"
          name="name"
          type="text"
          required
          value={form.name}
          onChange={handleChange}
          className={fieldClass}
          placeholder="Aquatics"
        />
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>Description</label>
        <textarea
          id="description"
          name="description"
          rows={3}
          value={form.description}
          onChange={handleChange}
          className={fieldClass}
          placeholder="Optional description..."
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <input
          id="is_published"
          name="is_published"
          type="checkbox"
          checked={form.is_published}
          onChange={handleChange}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <div>
          <label htmlFor="is_published" className="text-sm font-medium text-gray-700">
            Publish this department
          </label>
          <p className="text-xs text-gray-500">
            Visible on the public Dropin discovery pages.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Saving…" : isEditing ? "Save changes" : "Add department"}
        </button>
      </div>
    </form>
  );
}
