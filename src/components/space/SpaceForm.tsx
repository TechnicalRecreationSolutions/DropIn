"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LabelWithInfo } from "@/components/ui/info-tip";

interface SpaceFormProps {
  facilityId: string;
  spaceId?: string;
  departments: { id: string; name: string }[];
  /** Zone labels already used at this facility — offered as suggestions so the
   *  free-text field does not quietly sprout "Main pool" alongside "Main Pool". */
  zoneNames?: string[];
  defaultValues?: {
    name?: string;
    department_id?: string | null;
    zone_name?: string | null;
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
  zoneNames = [],
  defaultValues,
  redirectTo,
}: SpaceFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!spaceId;

  const [form, setForm] = useState(() => initialForm(defaultValues));

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Re-seed when the server hands down different defaults.
   *
   * Next hides route segments with React's `<Activity>` rather than
   * unmounting them, and reuses the same instance when you return, so this
   * component outlives the page it was opened from:
   * `useState` runs once, ever, and every later visit re-renders it with new
   * props and the OLD state. Without this, opening "+ Add" under Aquatics
   * after having opened the plain "Add space" silently drops the
   * `?departmentId=` seed, and the edit form reopens showing the row as it
   * was before the last save.
   *
   * Compared by value, not identity: `defaultValues` is rebuilt on every
   * server render, so an identity check would re-seed constantly and eat
   * what is being typed.
   *
   * Adjusted during render rather than in an effect — an effect would paint
   * the stale values once and then correct them. Never while a save is in
   * flight: a render that started before the submit carries pre-save props,
   * and adopting those would overwrite the values on their way to the server.
   */
  const defaultsKey = JSON.stringify(initialForm(defaultValues));
  const [seededFrom, setSeededFrom] = useState(defaultsKey);
  if (seededFrom !== defaultsKey && !loading) {
    setSeededFrom(defaultsKey);
    setForm(initialForm(defaultValues));
    setError(null);
  }

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
          zone_name: form.zone_name.trim() || null,
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

    // Next wraps route segments in React's `<Activity>` under
    // `cacheComponents`, so leaving this page hides it rather than unmounting
    // it, and coming back REUSES the same component instance — state and all.
    // /spaces/new is one URL, so "Add another space" lands right back on the
    // component that submitted the first one. Nothing remounts it, so nothing
    // resets it for us. (next/dist/docs/01-app/02-guides/preserving-ui-state.md,
    // "Resetting form state on submit" — the documented fix is this one.)
    //
    // Left alone, the second "Add space" therefore opens pre-filled with the
    // lane just saved and permanently disabled on "Saving…", because
    // `loading` was only ever cleared on the error path. Both have to be
    // cleared here, before navigating.
    //
    // Only the create form resets its fields: the edit form's state is now
    // exactly what was written, so keeping it means a revived editor shows
    // the saved space rather than the pre-edit props it was rendered with.
    setLoading(false);
    setError(null);
    if (!isEditing) setForm(initialForm(defaultValues));

    queryClient.invalidateQueries({ queryKey: ["nav-tree"] });
    router.push(redirectTo);
    router.refresh();
  }

  const fieldClass = "w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-foreground mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-card rounded-xl border border-border p-6">
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
        <LabelWithInfo htmlFor="zone_name" className={labelClass} info="Groups spaces on the Spaces page. Doesn't affect booking.">Zone</LabelWithInfo>
        {/* Free text with suggestions rather than a picker: a zone is a label
            the Spaces page groups by, not a record, so there is nothing to
            create first. The datalist is what keeps the spelling consistent. */}
        <input
          id="zone_name"
          name="zone_name"
          type="text"
          list="space-zone-names"
          value={form.zone_name}
          onChange={handleChange}
          className={fieldClass}
          placeholder="Optional — e.g. Main Pool, Gym Floor"
        />
        <datalist id="space-zone-names">
          {zoneNames.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </div>

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
          className="w-4 h-4 rounded border-border text-blue-600 dark:text-blue-400 focus:ring-blue-500"
        />
        <div>
          <label htmlFor="is_published" className="text-sm font-medium text-foreground">
            Publish this space
          </label>
          <p className="text-xs text-muted-foreground">
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
          className="px-4 py-2.5 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
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

/**
 * The blank (or department-seeded) state this form opens in — shared by the
 * initial `useState` and by the reset after a successful create, so the two
 * can never drift.
 */
function initialForm(defaultValues: SpaceFormProps["defaultValues"]) {
  return {
    name: defaultValues?.name ?? "",
    department_id: defaultValues?.department_id ?? "",
    zone_name: defaultValues?.zone_name ?? "",
    description: defaultValues?.description ?? "",
    capacity: defaultValues?.capacity != null ? String(defaultValues.capacity) : "",
    is_published: defaultValues?.is_published ?? false,
  };
}
