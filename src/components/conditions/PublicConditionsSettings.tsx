"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import type { PublicHeadcountMode } from "@/types/app.types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label, FieldHelp } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * What this building publishes about itself, on the facility Edit page.
 *
 * It lived at the foot of the status page until 2026-10-01, when the user
 * asked for that page to hold no settings: the status page is opened mid-shift
 * by whoever is on deck, and this is set once by a manager.
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
  /** Where staff record counts and temperatures — the status page. */
  statusHref: string;
  initial: {
    publicConditions: boolean;
    publicHeadcount: PublicHeadcountMode;
    occupancyCapacity: number | null;
  };
  canEdit: boolean;
  /** Whether anything has ever been recorded here — changes what "off" means. */
  hasReadings: boolean;
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
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
  statusHref,
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
  // Folded by default: this is set once and left, and it sat under the
  // notices as a full form. Opened when someone arrives on #public (the
  // Settings › Public presence rows link here).
  const arrivedForThis = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash === "#public",
    () => false
  );
  const [userOpen, setOpen] = useState<boolean | null>(null);
  const open = userOpen ?? arrivedForThis;

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
    <Collapsible open={open} onOpenChange={setOpen} asChild>
    <section id="public" className="scroll-mt-20 space-y-4">
      <CollapsibleTrigger className="group flex w-full items-start justify-between gap-3 rounded-card px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-heading text-foreground">
            {conditions || headcount !== "hidden" ? (
              <Eye className="size-4 text-muted-foreground" aria-hidden />
            ) : (
              <EyeOff className="size-4 text-muted-foreground" aria-hidden />
            )}
            What patrons see
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {summary(initial)}
          </span>
        </span>
        <ChevronDown
          className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4">
      <p className="text-sm text-muted-foreground">
        From the numbers staff record under People here on the{" "}
        <a href={statusHref} className="font-medium text-brand underline-offset-4 hover:underline">
          status page
        </a>
        . Nothing here is published until you turn it on, and a reading that has gone stale
        drops off the page on its own.
      </p>

      <div className="space-y-5 rounded-card border border-border bg-card p-5 shadow-card">
        <fieldset disabled={!canEdit} className="space-y-3">
          <legend className="text-card-title text-foreground">Occupancy</legend>
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
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="font-medium text-foreground">{opt.label}</span>
                <span className="block text-caption text-muted-foreground">{opt.hint}</span>
              </span>
            </label>
          ))}

          <div className="pl-6">
            <Label htmlFor="capacity">
              Building capacity
            </Label>
            <Input
              id="capacity"
              type="text"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => {
                setCapacity(e.target.value.replace(/[^0-9]/g, ""));
                setSaved(false);
              }}
              placeholder="250"
              className="w-32"
            />
            <FieldHelp>
              What &ldquo;busy&rdquo; is measured against. A count about one space uses that
              space&rsquo;s own capacity instead, set on the Spaces page.
            </FieldHelp>
            {needsCapacity && (
              <Banner variant="warning" role={undefined} className="mt-2">
                Without a capacity there is nothing to measure &ldquo;busy&rdquo; against, so
                nothing will appear on the public page &mdash; and no error will say why.
              </Banner>
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
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="font-medium text-foreground">Show water and air temperature</span>
              <span className="block text-caption text-muted-foreground">
                Whatever staff last recorded, with the time it was taken. Hidden again once it
                is more than twelve hours old.
              </span>
            </span>
          </label>
        </fieldset>

        {!hasReadings && (conditions || headcount !== "hidden") && (
          <Banner variant="neutral" role={undefined}>
            Nothing has been recorded at this facility yet, so patrons will not see anything
            until someone logs a count on the status page.
          </Banner>
        )}

        {error && (
          <Banner variant="error">
            {error}
          </Banner>
        )}

        {canEdit && (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            {saved && !dirty && (
              <span role="status" className="text-sm font-medium text-success">
                Saved.
              </span>
            )}
          </div>
        )}
      </div>
      </CollapsibleContent>
    </section>
    </Collapsible>
  );
}

/** The folded row's one-line answer to "what is public here?" — the saved state, not the edit. */
function summary(initial: PublicConditionsSettingsProps["initial"]): string {
  const occupancy =
    initial.publicHeadcount === "count"
      ? "Exact head count shown"
      : initial.publicHeadcount === "level"
        ? "How busy shown"
        : "Occupancy hidden";
  return `${occupancy} · Temperatures ${initial.publicConditions ? "shown" : "hidden"}`;
}
