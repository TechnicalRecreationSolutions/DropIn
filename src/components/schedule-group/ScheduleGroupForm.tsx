"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { SPORT_CATEGORIES } from "@/lib/utils/sport-categories";
import { commandCentreHref, scheduleGroupScope } from "@/lib/schedule/commandCentreHref";

interface ScheduleGroupFormProps {
  facilityId: string;
  /** Pre-filled when created from a department's page; still editable either way. */
  departmentId?: string;
  scheduleGroupId?: string;
  defaultValues?: {
    name?: string;
    sport_category?: string;
    cost_cents?: number;
    status?: "draft" | "published";
    starts_on?: string | null;
    ends_on?: string | null;
  };
}

interface FacilityOption {
  id: string;
  name: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface SeasonOption {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
}

/** Sentinel picker value meaning "not tied to a season's dates". */
const CUSTOM_DATES = "";

export default function ScheduleGroupForm({
  facilityId,
  departmentId: defaultDepartmentId,
  scheduleGroupId,
  defaultValues,
}: ScheduleGroupFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!scheduleGroupId;

  const [form, setForm] = useState({
    name: defaultValues?.name ?? "",
    facility_id: facilityId,
    department_id: defaultDepartmentId ?? "",
    sport_category: defaultValues?.sport_category ?? "swimming",
    cost_dollars: defaultValues?.cost_cents ? String(defaultValues.cost_cents / 100) : "0",
    status: defaultValues?.status ?? "draft",
    starts_on: defaultValues?.starts_on ?? "",
    ends_on: defaultValues?.ends_on ?? "",
  });

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [seasonId, setSeasonId] = useState(CUSTOM_DATES);

  // The org's facilities, for the picker. Org-wide, so fetched once.
  useEffect(() => {
    fetch("/api/nav-tree")
      .then((res) => res.json())
      .then((data) => setFacilities(data.facilities ?? []))
      .catch(() => setFacilities([]));
  }, []);

  // The org's seasons, for the dates picker. Org-wide, so fetched once.
  useEffect(() => {
    fetch("/api/seasons")
      .then((res) => res.json())
      .then((data) => setSeasons(data.seasons ?? []))
      .catch(() => setSeasons([]));
  }, []);

  // Departments are scoped to whichever facility is currently selected —
  // refetches whenever that changes, including from the picker below.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/departments?facilityId=${form.facility_id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setDepartments(data.departments ?? []);
      })
      .catch(() => {
        if (!cancelled) setDepartments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.facility_id]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  }

  function handleFacilityChange(e: React.ChangeEvent<HTMLSelectElement>) {
    // A department belongs to one facility, so switching facilities always
    // clears it rather than carrying over an id that no longer applies.
    setForm((prev) => ({ ...prev, facility_id: e.target.value, department_id: "" }));
  }

  function handleSeasonChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setSeasonId(id);
    if (id === CUSTOM_DATES) return;
    const season = seasons.find((s) => s.id === id);
    if (!season) return;
    // A one-time prefill, not a binding — starts_on/ends_on are plain columns
    // on schedule_groups (no season_id FK), so this just copies the dates
    // across. Editing them afterward doesn't move the picker back to "Custom".
    setForm((prev) => ({ ...prev, starts_on: season.starts_on, ends_on: season.ends_on }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) {
      setError("End date must be on or after the start date.");
      return;
    }

    setLoading(true);

    const costCents = Math.round(parseFloat(form.cost_dollars || "0") * 100);

    const payload = {
      name: form.name,
      facility_id: form.facility_id,
      department_id: form.department_id || null,
      sport_category: form.sport_category,
      cost_cents: isNaN(costCents) ? 0 : costCents,
      status: form.status,
      starts_on: form.starts_on || null,
      ends_on: form.ends_on || null,
    };

    const res = await fetch(
      isEditing ? `/api/schedule-groups/${scheduleGroupId}` : "/api/schedule-groups",
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["nav-tree"] });
    // Built from what was actually saved, not the page's starting scope, so
    // a facility or department change lands on the schedule where it now
    // lives instead of a stale URL.
    router.push(commandCentreHref(scheduleGroupScope(data.scheduleGroup)));
    router.refresh();
  }

  const fieldClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
      <div>
        <label htmlFor="name" className={labelClass}>Schedule name *</label>
        <input id="name" name="name" type="text" required value={form.name} onChange={handleChange}
          className={fieldClass} placeholder="Lap Swimming" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="facility_id" className={labelClass}>Facility *</label>
          <select id="facility_id" name="facility_id" required value={form.facility_id} onChange={handleFacilityChange} className={fieldClass}>
            {!facilities.some((f) => f.id === form.facility_id) && (
              <option value={form.facility_id}>Loading…</option>
            )}
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="department_id" className={labelClass}>
            Department <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <select id="department_id" name="department_id" value={form.department_id} onChange={handleChange} className={fieldClass}>
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="sport_category" className={labelClass}>Sport / Activity *</label>
        <select id="sport_category" name="sport_category" required value={form.sport_category} onChange={handleChange} className={fieldClass}>
          {SPORT_CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="cost_dollars" className={labelClass}>Drop-in cost ($)</label>
        <input id="cost_dollars" name="cost_dollars" type="number" min="0" step="0.01"
          value={form.cost_dollars} onChange={handleChange} className={fieldClass} placeholder="0.00" />
      </div>

      <div className="border-t border-gray-100 pt-5 space-y-4">
        <div>
          <label htmlFor="status" className={labelClass}>Status</label>
          <select id="status" name="status" value={form.status} onChange={handleChange} className={fieldClass}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">Only published schedules are visible on the public schedule page and widget.</p>
        </div>

        <div>
          <label htmlFor="season_id" className={labelClass}>
            Season <span className="font-normal text-gray-400">(optional — fills in the dates below)</span>
          </label>
          <select id="season_id" name="season_id" value={seasonId} onChange={handleSeasonChange} className={fieldClass}>
            <option value={CUSTOM_DATES}>Custom dates</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="starts_on" className={labelClass}>Starts</label>
            <input id="starts_on" name="starts_on" type="date"
              value={form.starts_on} onChange={handleChange} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="ends_on" className={labelClass}>Ends (optional)</label>
            <input id="ends_on" name="ends_on" type="date"
              value={form.ends_on} onChange={handleChange} className={fieldClass} />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          A start date is needed to publish. Leave &ldquo;Ends&rdquo; blank for a
          schedule that just keeps running, like a weekly drop-in — that&rsquo;s
          the common case, not the exception.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={() => router.back()}
          className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading}
          className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {loading ? "Saving…" : isEditing ? "Save changes" : "Add schedule"}
        </button>
      </div>
    </form>
  );
}
