"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import StepCard from "@/components/ui/step-card";
import SessionTags from "@/components/schedule/SessionTags";
import {
  OCCUPANCY_KINDS,
  DISCLOSURE_OPTIONS,
  type OccupancyKind,
  type Disclosure,
} from "@/lib/sessions/occupancy";
import TagPicker, { type TagOption } from "./TagPicker";
import LinksEditor, { type LinkDraft } from "./LinksEditor";

interface SessionTemplateFormProps {
  facilityId: string;
  /** Null means facility-wide — reusable by every schedule in the building. */
  departmentId: string | null;
  templateId?: string;
  spaces: { id: string; name: string }[];
  defaultValues?: {
    name?: string;
    color?: string | null;
    description?: string | null;
    default_duration_minutes?: number;
    occupancy_kind?: OccupancyKind;
    disclosure?: Disclosure;
    default_space_ids?: string[];
    /** Migration 050, in the order they render — see TagPicker. */
    tag_ids?: string[];
    links?: LinkDraft[];
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

/**
 * The durations that actually get used, as one-tap chips.
 *
 * A number input asks staff to think in minutes and type; a pool runs 30, 45,
 * 60, 90 and 120 minute blocks and almost nothing else. The field stays for the
 * genuine exception, but the common case is now a single tap.
 */
const DURATION_PRESETS = [30, 45, 60, 90, 120];

/** "1h 30m" rather than "90 minutes" — how a schedule is actually read aloud. */
function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/**
 * A sample 9am time range for the card preview.
 *
 * Deliberately a made-up time: a template has no time of its own — it carries a
 * *length*, and the time is chosen when it is dragged onto the grid. Showing a
 * range rather than "60 min" is what makes the preview look like the card it is
 * previewing, and 9:00 is a legible anchor rather than a claim.
 */
function sampleRange(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "9:00 AM";
  const label = (totalMinutes: number) => {
    const h24 = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    const suffix = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
  };
  const start = 9 * 60;
  return `${label(start)}–${label(start + minutes)}`;
}

/** Right-aligned one-line summary in a step header, so a collapsed glance is enough. */
function StepSummary({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

/**
 * Create/edit form for a session template, as three numbered steps.
 *
 * It was one flat card of eight field groups, which was survivable when there
 * were five and stopped being so when migration 050 added description, tags and
 * links. Nothing was required except name and duration, but nothing said so, so
 * the form read as eight decisions rather than two.
 *
 * The steps are grouped by the question being answered, not by which table the
 * column lives in:
 *
 *  1. **What it is** — the name and colour, the identity staff scan for.
 *  2. **What gets pre-filled** — duration, spaces, and the occupancy seeds from
 *     047. These belong together because they are the same kind of thing: every
 *     one of them is a *default* that a placed session then owns outright.
 *     Splitting duration from the occupancy pair (as the old layout did) hid
 *     that they behave identically.
 *  3. **What patrons see** — description, tags, links. All three public, all
 *     three optional.
 *
 * Steps 2 and 3 carry a live summary in the header, so the parts you are not
 * editing can be read without scrolling to them, and step 3 shows the actual
 * session card being built rather than describing it.
 *
 * Same numbered-step chrome as the widget studio (`ui/step-card.tsx`), for the
 * same reason recorded in `components/widget/README.md`: a pile of visually
 * identical cards has no first thing to do and no last.
 */
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
  // Migration 050 — all three are presentation, all three optional.
  const [description, setDescription] = useState(defaultValues?.description ?? "");
  const [tagIds, setTagIds] = useState<string[]>(defaultValues?.tag_ids ?? []);
  const [links, setLinks] = useState<LinkDraft[]>(defaultValues?.links ?? []);
  // The facility's whole tag vocabulary, lifted out of TagPicker so the preview
  // below can render the selected tags rather than just count them.
  const [vocabulary, setVocabulary] = useState<TagOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Stable, so TagPicker's load effect can depend on it without re-firing every
  // render — an inline arrow here would refetch the vocabulary in a loop.
  const handleVocabulary = useCallback((tags: TagOption[]) => setVocabulary(tags), []);

  const duration = Number(durationMinutes);
  const durationValid = Number.isInteger(duration) && duration > 0;

  function toggleSpace(id: string) {
    setDefaultSpaceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  /**
   * Selected tags in the order staff picked them, which is the order they
   * render and therefore which two reach a card. Built from `tagIds` rather
   * than from `vocabulary` so a tag deleted elsewhere simply drops out.
   */
  const selectedTags = useMemo(
    () =>
      tagIds
        .map((id) => vocabulary.find((t) => t.id === id))
        .filter((t): t is TagOption => t !== undefined),
    [tagIds, vocabulary]
  );

  const occupancyLabel = OCCUPANCY_KINDS.find((k) => k.value === occupancyKind)?.label;
  const spacesSummary =
    defaultSpaceIds.length === 0
      ? "no usual space"
      : defaultSpaceIds.length === spaces.length
        ? "all spaces"
        : `${defaultSpaceIds.length} space${defaultSpaceIds.length === 1 ? "" : "s"}`;

  const publicBits = [
    description.trim() ? "description" : null,
    tagIds.length ? `${tagIds.length} tag${tagIds.length === 1 ? "" : "s"}` : null,
    links.length ? `${links.length} link${links.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!durationValid) {
      setError("Duration must be a positive whole number of minutes.");
      return;
    }

    // Half-filled rows are dropped rather than rejected: a staff member who
    // clicked "Add link" and changed their mind should not have to find the
    // empty row to save the form. A row with only one side filled is a mistake
    // worth naming, though — silently discarding a typed URL whose label was
    // forgotten would lose work.
    const cleanedLinks = links.filter((l) => l.label.trim() || l.url.trim());
    const incomplete = cleanedLinks.find((l) => !l.label.trim() || !l.url.trim());
    if (incomplete) {
      setError("Every link needs both a label and an address.");
      return;
    }

    const badUrl = cleanedLinks.find((l) => !/^https?:\/\//i.test(l.url.trim()));
    if (badUrl) {
      setError(`"${badUrl.label}" must start with http:// or https://`);
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
          description: description.trim() || null,
          default_duration_minutes: duration,
          default_space_ids: defaultSpaceIds,
          occupancy_kind: occupancyKind,
          disclosure,
          tag_ids: tagIds,
          links: cleanedLinks.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
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
  const chipClass = (selected: boolean) =>
    cn(
      "px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors",
      selected
        ? "bg-blue-600 border-blue-600 text-white"
        : "border-border text-muted-foreground hover:border-blue-300"
    );

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pb-24">
      <StepCard
        step={1}
        title="What it is"
        description="The name staff scan for on the grid, and the colour it carries."
        meta={name.trim() ? <StepSummary>{name.trim()}</StepSummary> : undefined}
      >
        <div>
          <label htmlFor="name" className={labelClass}>Template name *</label>
          <input
            id="name"
            type="text"
            required
            autoFocus={!isEditing}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
            placeholder="Water Walking, Adult Lengths, Family Splash"
          />
        </div>

        <div>
          <p className={labelClass}>Colour</p>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                className={cn(
                  "w-8 h-8 rounded-full border-2 transition-transform",
                  color === preset ? "border-gray-900 scale-110" : "border-transparent"
                )}
                style={{ backgroundColor: preset }}
                aria-label={`Use colour ${preset}`}
                aria-pressed={color === preset}
              />
            ))}
            {/* The custom picker sits inline with the presets rather than on its
                own row below them — it is the twelfth option, not a second
                decision. */}
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <span className="sr-only">Custom colour</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-8 h-8 rounded-full border border-border cursor-pointer"
              />
              <span className="text-xs text-muted-foreground font-mono">{color}</span>
            </label>
          </div>
        </div>
      </StepCard>

      <StepCard
        step={2}
        title="What gets pre-filled"
        description="Starting values when you drag this onto a schedule. The session owns them from then on — changing them here never touches a session that already exists."
        meta={
          <StepSummary>
            {formatDuration(duration)} · {spacesSummary} · {occupancyLabel}
          </StepSummary>
        }
      >
        <div>
          <p className={labelClass}>Usual length *</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setDurationMinutes(String(preset))}
                className={chipClass(duration === preset)}
                aria-pressed={duration === preset}
              >
                {formatDuration(preset)}
              </button>
            ))}
            <span className="inline-flex items-center gap-1.5 ml-1">
              <input
                id="default_duration_minutes"
                type="number"
                min={1}
                step={1}
                required
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                aria-label="Custom duration in minutes"
                className="w-20 px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-muted-foreground">min</span>
            </span>
          </div>
          {!durationValid && (
            <p className="text-xs text-red-600 mt-1">
              Enter a whole number of minutes greater than zero.
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className={cn(labelClass, "mb-0")}>Usual spaces</p>
            {/* Lap swim occupies every lane. Selecting eight of them one at a
                time was the single slowest interaction on this form. */}
            {spaces.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setDefaultSpaceIds(
                    defaultSpaceIds.length === spaces.length ? [] : spaces.map((s) => s.id)
                  )
                }
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                {defaultSpaceIds.length === spaces.length ? "Clear all" : "Select all"}
              </button>
            )}
          </div>
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
                      className={chipClass(selected)}
                      aria-pressed={selected}
                    >
                      {space.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Every space this activity usually occupies at once — e.g. all four lanes for Lap
                Swim.
              </p>
            </>
          )}
        </div>

        <div>
          <p className={labelClass}>Usually a…</p>
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
                  className={chipClass(selected)}
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
          </div>
        </div>
      </StepCard>

      <StepCard
        step={3}
        title="What patrons see"
        description="Optional. Shown on the public schedule and when a visitor taps this session."
        meta={
          <StepSummary>{publicBits.length ? publicBits.join(" · ") : "Nothing added"}</StepSummary>
        }
      >
        {/* The card being built, drawn the way WeeklyScheduleGrid draws it.
            Colour is chosen back in step 1 and tags here, and neither reads as
            a visual decision until they are seen together on the thing they
            actually produce. */}
        <div>
          <p className={labelClass}>On the schedule</p>
          <div
            className="inline-block min-w-[11rem] max-w-full rounded-md px-2.5 py-2 border"
            style={{
              color: "var(--org-text-on-tint, #1e3a5f)",
              backgroundColor: `color-mix(in srgb, ${color} 12%, white)`,
              borderColor: `color-mix(in srgb, ${color} 40%, white)`,
            }}
          >
            <p className="text-xs font-semibold leading-tight truncate">
              {name.trim() || "Untitled template"}
            </p>
            <p className="text-xs opacity-75 leading-tight mt-0.5">{sampleRange(duration)}</p>
            <SessionTags tags={selectedTags} className="mt-1" />
          </div>
          {selectedTags.length > 2 && (
            <p className="text-xs text-muted-foreground mt-1">
              The other {selectedTags.length - 2} tag
              {selectedTags.length - 2 === 1 ? "" : "s"} appear when a visitor taps the session.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            className={fieldClass}
            placeholder="Lanes are set for continuous swimming. Please self-select a lane by speed."
          />
          <p className="text-xs text-muted-foreground mt-1">
            Plain text — line breaks are kept, formatting is not.
          </p>
        </div>

        <TagPicker
          facilityId={facilityId}
          selectedIds={tagIds}
          onChange={setTagIds}
          onVocabularyChange={handleVocabulary}
        />

        <LinksEditor links={links} onChange={setLinks} />
      </StepCard>

      {/* Sticky, because three steps is taller than a phone and the old layout
          put Save at the bottom of all of it. The error sits in the same bar so
          a failed save cannot scroll itself out of view.

          The 65px is the measured height of `DashboardBottomNav`, which is
          `fixed bottom-0 z-50` below `lg`. At `bottom-0` this bar sits *behind*
          it and the save button is completely invisible on a phone — measured,
          not guessed: the nav occupied 779–844 on a 390×844 viewport and the
          button 790–832. Raising this bar's z-index instead would bury the
          app's primary navigation, so it clears the nav rather than covering
          it. verify-ac §2 asserts the two never overlap, so a change to the
          nav's height fails loudly instead of hiding Save again. */}
      <div className="fixed bottom-[65px] lg:bottom-0 inset-x-0 z-20 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
          {error && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2.5 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || !durationValid}
              className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading
                ? "Saving…"
                : isEditing
                  ? "Save changes"
                  : "Create template"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
