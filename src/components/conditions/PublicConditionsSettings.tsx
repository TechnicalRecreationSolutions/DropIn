"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import type { PublicHeadcountMode } from "@/types/app.types";

/**
 * What this building publishes about itself, on the status page.
 *
 * ## Why the head count has three settings and not a checkbox
 *
 * "How busy is it?" is the question patrons actually ask, and the exact number
 * is a bad answer to it twice over. It invites comparison a count made by eye
 * from a deck cannot support, and at a small facility "3 people here" is close
 * to naming them. A band — quiet, busy, at capacity — answers the question
 * without either problem, and the exact figure never leaves the database:
 * `facility_public_conditions()` returns the band instead of the number, so
 * "level" is not a display choice that a future API route could undo.
 *
 * Some centres do want the number, which is why "count" exists. The default is
 * `hidden`: publishing an occupancy figure is a decision, not a default.
 *
 * ## A band needs a denominator, and the form says so rather than guessing
 *
 * Without a capacity there is nothing to divide by, and the function drops the
 * reading rather than falling back to the raw number — because falling back
 * would publish precisely what the mode exists to withhold. The field is
 * therefore required-in-practice for `level`, and the warning below says what
 * silence would otherwise look like: nothing on the page, and no error.
 */

export interface PublicConditionsSettingsProps {
  facilityId: string;
  initial: {
    publicConditions: boolean;
    publicHeadcount: PublicHeadcountMode;
    occupancyCapacity: number | null;
  };
  canEdit: boolean;
  /** Whether anything has ever been recorded here — changes what "off" means. */
  hasReadings: boolean;
}

const HEADCOUNT_OPTIONS: { value: PublicHeadcountMode; label: string; hint: string }[] = [
  { value: "hidden", label: "Nothing", hint: "Patrons see no occupancy information." },
  {
    value: "level",
    label: "How busy (quiet / busy / at capacity)",
    hint: "A band, not a number. Needs a capacity below.",
  },
  {
    value: "count",
    label: "The exact count",
    hint: "“About 40 people here, counted at 2:15 PM.”",
  },
];

export default function PublicConditionsSettings({
  facilityId,
  initial,
  canEdit,
  hasReadings,
}: PublicConditionsSettingsProps) {
  const router = useRouter();
  const [conditions, setConditions] = useState(initial.publicConditions);
  const [headcount, setHeadcount] = useState<PublicHeadcountMode>(initial.publicHeadcount);
  const [capacity, setCapacity] = useState(
    initial.occupancyCapacity != null ? String(initial.occupancyCapacity) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    conditions !== initial.publicConditions ||
    headcount !== initial.publicHeadcount ||
    (capacity === "" ? null : Number(capacity)) !== initial.occupancyCapacity;

  // The failure this warns about is SILENT: level mode with nothing to divide
  // by produces no row, so the page simply has no occupancy on it and nobody
  // is told why.
  const needsCapacity = headcount === "level" && capacity.trim() === "";

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/facilities/${facilityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_conditions: conditions,
        public_headcount: headcount,
        occupancy_capacity: capacity.trim() === "" ? null : Number(capacity),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save those settings.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <section id="public" className="scroll-mt-20 space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {conditions || headcount !== "hidden" ? (
            <Eye className="size-4 text-muted-foreground" aria-hidden />
          ) : (
            <EyeOff className="size-4 text-muted-foreground" aria-hidden />
          )}
          What patrons see
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          From the numbers staff record on the{" "}
          <a href="/dashboard/counts" className="underline underline-offset-2">
            head count tool
          </a>
          . Nothing here is published until you turn it on, and a reading that has gone stale
          drops off the page on its own.
        </p>
      </div>

      <div className="space-y-5 rounded-xl border border-border bg-card p-4">
        <fieldset disabled={!canEdit} className="space-y-3">
          <legend className="text-sm font-medium text-foreground">Occupancy</legend>
          {HEADCOUNT_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2.5 text-sm">
              <input
                type="radio"
                name="public_headcount"
                value={opt.value}
                checked={headcount === opt.value}
                onChange={() => {
                  setHeadcount(opt.value);
                  setSaved(false);
                }}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="font-medium text-foreground">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.hint}</span>
              </span>
            </label>
          ))}

          <div className="pl-6">
            <label htmlFor="capacity" className="mb-1 block text-sm font-medium">
              Building capacity
            </label>
            <input
              id="capacity"
              type="text"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => {
                setCapacity(e.target.value.replace(/[^0-9]/g, ""));
                setSaved(false);
              }}
              placeholder="250"
              className="w-32 rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              What &ldquo;busy&rdquo; is measured against. A count about one space uses that
              space&rsquo;s own capacity instead, set on the Spaces page.
            </p>
            {needsCapacity && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-500/40 dark:bg-amber-500/10">
                Without a capacity there is nothing to measure &ldquo;busy&rdquo; against, so
                nothing will appear on the public page &mdash; and no error will say why.
              </p>
            )}
          </div>
        </fieldset>

        <fieldset disabled={!canEdit} className="border-t border-border pt-4">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={conditions}
              onChange={(e) => {
                setConditions(e.target.checked);
                setSaved(false);
              }}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium text-foreground">Show water and air temperature</span>
              <span className="block text-xs text-muted-foreground">
                Whatever staff last recorded, with the time it was taken. Hidden again once it
                is more than twelve hours old.
              </span>
            </span>
          </label>
        </fieldset>

        {!hasReadings && (conditions || headcount !== "hidden") && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Nothing has been recorded at this facility yet, so patrons will not see anything
            until someone uses the head count tool.
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && !dirty && (
              <span role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
                Saved.
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
