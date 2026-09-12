"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import {
  OCCUPANCY_KINDS,
  DISCLOSURE_OPTIONS,
  type OccupancyKind,
  type Disclosure,
} from "@/lib/sessions/occupancy";

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
    occupancy_kind?: OccupancyKind;
    disclosure?: Disclosure;
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
  // Seeds for every session placed from this template (migration 047) — the
  // reason a club booking is one drag rather than a drag plus two corrections.
  const [occupancyKind, setOccupancyKind] = useState<OccupancyKind>(
    defaultValues?.occupancy_kind ?? "drop_in"
  );
  const [disclosure, setDisclosure] = useState<Disclosure>(defaultValues?.disclosure ?? "public");
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
          occupancy_kind: occupancyKind,
          disclosure,
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

  const fieldClass = "w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-foreground mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-card rounded-xl border border-border p-6">
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
            className="w-10 h-10 rounded-lg border border-border"
          />
          <span className="text-sm text-muted-foreground font-mono">{color}</span>
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
        <p className="text-xs text-muted-foreground mt-1">
          Used to pre-fill the end time when this template is placed on a schedule.
        </p>
      </div>

      {/* Occupancy seeds (migration 047). Placed after duration and before
          spaces so the form reads as one list of "what this activity usually
          is" — the same order the create dialog then pre-fills in. */}
      <div>
        <label className={labelClass}>Usually a…</label>
        <div className="flex gap-1.5 flex-wrap">
          {OCCUPANCY_KINDS.map((kind) => {
            const selected = occupancyKind === kind.value;
            return (
              <button
                key={kind.value}
                type="button"
                onClick={() => {
                  setOccupancyKind(kind.value);
                  setDisclosure(kind.defaultDisclosure);
                }}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors",
                  selected
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-border text-muted-foreground hover:border-blue-300"
                )}
                aria-pressed={selected}
              >
                {kind.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {OCCUPANCY_KINDS.find((k) => k.value === occupancyKind)?.hint}
        </p>

        <div className="mt-3">
          <label htmlFor="template_disclosure" className={labelClass}>Patrons usually see</label>
          <select
            id="template_disclosure"
            value={disclosure}
            onChange={(e) => setDisclosure(e.target.value as Disclosure)}
            className={fieldClass}
          >
            {DISCLOSURE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Both of these only pre-fill new sessions placed from this template. Changing them
            here never alters a session that already exists.
          </p>
        </div>
      </div>

      <div>
        <p className={labelClass}>Usual spaces</p>
        {spaces.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">No spaces set up for this facility.</p>
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
                        : "border-border text-muted-foreground hover:border-blue-300"
                    )}
                    aria-pressed={selected}
                  >
                    {space.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
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
          className="px-4 py-2.5 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
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
