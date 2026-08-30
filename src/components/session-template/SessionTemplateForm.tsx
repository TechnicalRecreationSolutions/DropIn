"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

interface SessionTemplateFormProps {
  facilityId: string;
  /** Null means facility-wide — reusable by every schedule in the building. */
  departmentId: string | null;
  templateId?: string;
  spaces: { id: string; name: string }[];
  defaultValues?: {
    name?: string;
    color?: string | null;
    default_duration_minutes?: number;
    default_space_ids?: string[];
  };
  /** Where to send staff after a successful save. */
  redirectTo: string;
}

const PRESET_COLORS = [
  "#3B82F6", // blue
  "#64748B", // slate
  "#06B6D4", // cyan
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#84CC16", // lime
  "#10B981", // emerald
  "#A855F7", // purple
  "#EC4899", // pink
  "#D946EF", // fuchsia
  "#6366F1", // indigo
];

export default function SessionTemplateForm({
  facilityId,
  departmentId,
  templateId,
  spaces,
  defaultValues,
  redirectTo,
}: SessionTemplateFormProps) {
  const router = useRouter();
  const isEditing = !!templateId;

  const [name, setName] = useState(defaultValues?.name ?? "");
  const [color, setColor] = useState(defaultValues?.color ?? PRESET_COLORS[0]);
  const [durationMinutes, setDurationMinutes] = useState(
    defaultValues?.default_duration_minutes != null ? String(defaultValues.default_duration_minutes) : "60"
  );
  const [defaultSpaceIds, setDefaultSpaceIds] = useState<string[]>(defaultValues?.default_space_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function toggleSpace(id: string) {
    setDefaultSpaceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration <= 0) {
      setError("Duration must be a positive whole number of minutes.");
      return;
    }

    setLoading(true);

    const res = await fetch(
      isEditing ? `/api/session-templates/${templateId}` : "/api/session-templates",
      {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEditing ? {} : { facility_id: facilityId, department_id: departmentId }),
          name,
          color: color || null,
          default_duration_minutes: duration,
          default_space_ids: defaultSpaceIds,
        }),
      }
    );

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  const fieldClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-xl border border-gray-200 p-6">
      <div>
        <label htmlFor="name" className={labelClass}>Template name *</label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
          placeholder="Water Walking, Adult Lengths, Family Splash"
        />
      </div>

      <div>
        <p className={labelClass}>Color</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setColor(preset)}
              className={`w-8 h-8 rounded-full border-2 transition-transform ${
                color === preset ? "border-gray-900 scale-110" : "border-transparent"
              }`}
              style={{ backgroundColor: preset }}
              aria-label={`Use color ${preset}`}
              aria-pressed={color === preset}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-10 h-10 rounded-lg border border-gray-300"
          />
          <span className="text-sm text-gray-500 font-mono">{color}</span>
        </div>
      </div>

      <div>
        <label htmlFor="default_duration_minutes" className={labelClass}>Default duration (minutes) *</label>
        <input
          id="default_duration_minutes"
          type="number"
          min={1}
          step={1}
          required
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(e.target.value)}
          className={fieldClass}
        />
        <p className="text-xs text-gray-500 mt-1">
          Used to pre-fill the end time when this template is placed on a schedule.
        </p>
      </div>

      <div>
        <p className={labelClass}>Usual spaces</p>
        {spaces.length === 0 ? (
          <p className="text-sm text-gray-400">No spaces set up for this facility.</p>
        ) : (
          <>
            <div className="flex gap-1.5 flex-wrap">
              {spaces.map((space) => {
                const selected = defaultSpaceIds.includes(space.id);
                return (
                  <button
                    key={space.id}
                    type="button"
                    onClick={() => toggleSpace(space.id)}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors",
                      selected
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "border-gray-200 text-gray-600 hover:border-blue-300"
                    )}
                    aria-pressed={selected}
                  >
                    {space.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Select every space this activity usually occupies at once (e.g. all 4 lanes for Lap Swim).
            </p>
          </>
        )}
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
          {loading ? "Saving…" : isEditing ? "Save changes" : "Add template"}
        </button>
      </div>
    </form>
  );
}
