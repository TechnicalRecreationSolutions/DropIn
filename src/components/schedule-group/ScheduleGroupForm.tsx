"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/utils/slugify";
import { SPORT_CATEGORIES } from "@/lib/utils/sport-categories";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

interface ScheduleGroupFormProps {
  orgId: string;
  facilityId: string;
  /** Pre-filled when created from a department's page; otherwise staff can pick one (or none). */
  departmentId?: string;
  scheduleGroupId?: string;
  defaultValues?: {
    name?: string;
    sport_category?: string;
    activity_type?: string;
    age_group?: string;
    skill_level?: string;
    cost_cents?: number;
    cost_notes?: string;
    description?: string;
    max_participants?: number | null;
    is_published?: boolean;
  };
  /** Where to send staff after a successful save. */
  redirectTo: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

const ACTIVITY_TYPES = [
  { value: "drop_in", label: "Drop-in" },
  { value: "open_gym", label: "Open Gym" },
  { value: "registered", label: "Registered Program" },
];

const AGE_GROUPS = [
  { value: "all_ages", label: "All ages" },
  { value: "youth", label: "Youth (under 18)" },
  { value: "adult", label: "Adult (18+)" },
  { value: "senior", label: "Senior (55+)" },
  { value: "family", label: "Family" },
];

const SKILL_LEVELS = [
  { value: "all_levels", label: "All levels" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

export default function ScheduleGroupForm({
  orgId,
  facilityId,
  departmentId: fixedDepartmentId,
  scheduleGroupId,
  defaultValues,
  redirectTo,
}: ScheduleGroupFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!scheduleGroupId;

  const [form, setForm] = useState({
    name: defaultValues?.name ?? "",
    department_id: fixedDepartmentId ?? "",
    sport_category: defaultValues?.sport_category ?? "swimming",
    activity_type: defaultValues?.activity_type ?? "drop_in",
    age_group: defaultValues?.age_group ?? "all_ages",
    skill_level: defaultValues?.skill_level ?? "all_levels",
    cost_dollars: defaultValues?.cost_cents ? String(defaultValues.cost_cents / 100) : "0",
    cost_notes: defaultValues?.cost_notes ?? "",
    description: defaultValues?.description ?? "",
    max_participants: defaultValues?.max_participants ? String(defaultValues.max_participants) : "",
    is_published: defaultValues?.is_published ?? false,
  });

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  // Auto-expand advanced options when editing a schedule that already has
  // non-default values set, so staff don't lose sight of their own data.
  const [advancedOpen, setAdvancedOpen] = useState(
    () =>
      !!(
        (defaultValues?.activity_type && defaultValues.activity_type !== "drop_in") ||
        (defaultValues?.age_group && defaultValues.age_group !== "all_ages") ||
        (defaultValues?.skill_level && defaultValues.skill_level !== "all_levels") ||
        defaultValues?.max_participants ||
        defaultValues?.cost_notes ||
        defaultValues?.description
      )
  );

  // If no department is pre-fixed by the route, let staff optionally pick one for this facility.
  useEffect(() => {
    if (fixedDepartmentId) return;
    let cancelled = false;
    fetch(`/api/departments?facilityId=${facilityId}`)
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
  }, [facilityId, fixedDepartmentId]);

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
    setLoading(true);

    const supabase = createClient();
    const costCents = Math.round(parseFloat(form.cost_dollars || "0") * 100);

    const payload = {
      name: form.name,
      slug: slugify(form.name),
      facility_id: facilityId,
      org_id: orgId,
      department_id: form.department_id || null,
      sport_category: form.sport_category,
      activity_type: form.activity_type as "drop_in" | "registered" | "open_gym",
      age_group: form.age_group || null,
      skill_level: form.skill_level || null,
      cost_cents: isNaN(costCents) ? 0 : costCents,
      cost_notes: form.cost_notes || null,
      description: form.description || null,
      max_participants: form.max_participants ? parseInt(form.max_participants) : null,
      is_published: form.is_published,
      source: "manual" as const,
    };

    let dbError;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = (supabase as any).from("schedule_groups");
    if (isEditing) {
      ({ error: dbError } = await table.update(payload).eq("id", scheduleGroupId));
    } else {
      ({ error: dbError } = await table.insert(payload));
    }

    if (dbError) {
      setError(
        dbError.code === "23505"
          ? "A schedule with this name already exists at that facility."
          : "Something went wrong. Please try again."
      );
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
        <label htmlFor="name" className={labelClass}>Schedule name *</label>
        <input id="name" name="name" type="text" required value={form.name} onChange={handleChange}
          className={fieldClass} placeholder="Lap Swimming" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {!fixedDepartmentId && (
          <div>
            <label htmlFor="department_id" className={labelClass}>
              Department <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <select id="department_id" name="department_id" value={form.department_id} onChange={handleChange} className={fieldClass}>
              <option value="">No department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="sport_category" className={labelClass}>Sport / Activity *</label>
          <select id="sport_category" name="sport_category" required value={form.sport_category} onChange={handleChange} className={fieldClass}>
            {SPORT_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="cost_dollars" className={labelClass}>Drop-in cost ($)</label>
        <input id="cost_dollars" name="cost_dollars" type="number" min="0" step="0.01"
          value={form.cost_dollars} onChange={handleChange} className={fieldClass} placeholder="0.00" />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border-t border-gray-100 pt-5">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900">
          <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          Advanced options
          <span className="font-normal text-gray-400">(type, age group, skill level, max participants, notes)</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-5 pt-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="activity_type" className={labelClass}>Type</label>
              <select id="activity_type" name="activity_type" value={form.activity_type} onChange={handleChange} className={fieldClass}>
                {ACTIVITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="age_group" className={labelClass}>Age group</label>
              <select id="age_group" name="age_group" value={form.age_group} onChange={handleChange} className={fieldClass}>
                {AGE_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="skill_level" className={labelClass}>Skill level</label>
              <select id="skill_level" name="skill_level" value={form.skill_level} onChange={handleChange} className={fieldClass}>
                {SKILL_LEVELS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="max_participants" className={labelClass}>Max participants</label>
            <input id="max_participants" name="max_participants" type="number" min="1"
              value={form.max_participants} onChange={handleChange} className={fieldClass} placeholder="Leave blank for unlimited" />
          </div>

          <div>
            <label htmlFor="cost_notes" className={labelClass}>Cost notes</label>
            <input id="cost_notes" name="cost_notes" type="text" value={form.cost_notes} onChange={handleChange}
              className={fieldClass} placeholder="e.g. Members free, Non-members $5" />
          </div>

          <div>
            <label htmlFor="description" className={labelClass}>Description</label>
            <textarea id="description" name="description" rows={3} value={form.description} onChange={handleChange}
              className={fieldClass} placeholder="Brief description of this schedule..." />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex items-center gap-3 border-t border-gray-100 pt-5">
        <input id="is_published" name="is_published" type="checkbox"
          checked={form.is_published} onChange={handleChange}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        <div>
          <label htmlFor="is_published" className="text-sm font-medium text-gray-700">Publish this schedule</label>
          <p className="text-xs text-gray-500">Visible on the public Dropin discovery pages.</p>
        </div>
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
