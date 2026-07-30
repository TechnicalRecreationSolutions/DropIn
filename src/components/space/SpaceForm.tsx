"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

interface SpaceFormProps {
  facilityId: string;
  spaceId?: string;
  departments: { id: string; name: string }[];
  defaultValues?: {
    name?: string;
    department_id?: string | null;
    description?: string;
    capacity?: number | null;
    is_published?: boolean;
  };
  /** Where to send staff after a successful save. */
  redirectTo: string;
}

export default function SpaceForm({
  facilityId,
  spaceId,
  departments,
  defaultValues,
  redirectTo,
}: SpaceFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!spaceId;

  const [form, setForm] = useState({
    name: defaultValues?.name ?? "",
    department_id: defaultValues?.department_id ?? "",
    description: defaultValues?.description ?? "",
    capacity: defaultValues?.capacity != null ? String(defaultValues.capacity) : "",
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

    const capacity = form.capacity.trim() ? Number(form.capacity) : null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) {
      setError("Capacity must be a positive whole number.");
      return;
    }

    setLoading(true);

    const res = await fetch(
      isEditing ? `/api/spaces/${spaceId}` : "/api/spaces",
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facility_id: facilityId,
          department_id: form.department_id || null,
          name: form.name,
          description: form.description || null,
          capacity,
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
    router.push(redirectTo);
    router.refresh();
  }

  const fieldClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
      <div>
        <label htmlFor="name" className={labelClass}>Space name *</label>
        <input
          id="name"
          name="name"
          type="text"
          required
          value={form.name}
          onChange={handleChange}
          className={fieldClass}
          placeholder="Lane 3, Court A, Studio 2"
        />
      </div>

      {departments.length > 0 && (
        <div>
          <label htmlFor="department_id" className={labelClass}>Department</label>
          <select
            id="department_id"
            name="department_id"
            value={form.department_id}
            onChange={handleChange}
            className={fieldClass}
          >
            <option value="">No department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="capacity" className={labelClass}>Capacity</label>
        <input
          id="capacity"
          name="capacity"
          type="number"
          min={1}
          step={1}
          value={form.capacity}
          onChange={handleChange}
          className={fieldClass}
          placeholder="Optional — max people/participants"
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
            Publish this space
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
          {loading ? "Saving…" : isEditing ? "Save changes" : "Add space"}
        </button>
      </div>
    </form>
  );
}
