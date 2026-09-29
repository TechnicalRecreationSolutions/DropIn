"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, Thermometer, Trash2, Users } from "lucide-react";
import {
  METRICS,
  formatReading,
  formatRecordedAt,
  isFresh,
} from "@/lib/conditions/readings";
import type { FacilityReading, ReadingMetric } from "@/types/app.types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The tool a lifeguard uses on deck.
 *
 * ## Designed for one thumb, standing up, in a wet room
 *
 * Everything that matters is above the fold at 390px and reachable without a
 * second hand: the space is a row of chips, the count is a pair of 56px
 * steppers either side of a number you can also type into, and submitting is
 * one full-width button. There is no dropdown, no date picker and no "save
 * and continue" — a guard has about fifteen seconds of attention to spare and
 * the thing this replaces is a clipboard.
 *
 * ## The stepper opens on the last count, not on zero
 *
 * A pool does not empty between counts. Starting from the previous number for
 * the selected space turns the common case — "about the same, maybe two more"
 * — into two taps instead of a typed number, and makes an accidental submit
 * land on a plausible value rather than zero.
 *
 * ## Recording again is how you correct a mistake
 *
 * There is no edit. The newest count for a space is the one the public sees,
 * and the log below shows what was written so a guard can see their own entry
 * land. Delete is for the typo that would otherwise sit in the eight-week
 * average — 400 instead of 40 — and it is deliberately not time-limited.
 */

interface Space {
  id: string;
  name: string;
  capacity: number | null;
}

export interface HeadCountToolProps {
  facilityId: string;
  spaces: Space[];
  /** The recent log, newest first, from the server. */
  readings: FacilityReading[];
  /** Names for the `recorded_by` column, so the log says who. */
  recorderNames: Record<string, string>;
  /** The viewer's own id, so "you" reads as "you". */
  viewerId: string;
  canWrite: boolean;
  /**
   * May delete OTHER people's entries — owner/manager (org_can_manage in the
   * facility_readings delete policy). Everyone else may delete only their own
   * row (recorded_by = auth.uid()), so the trash icon shows only on those.
   * Defaults to false: the narrow answer, until the caller says otherwise.
   */
  canManage?: boolean;
}

/** "" = the whole building, which is also the default. */
type SpaceChoice = string;

export default function HeadCountTool({
  facilityId,
  spaces,
  readings,
  recorderNames,
  viewerId,
  canWrite,
  canManage = false,
}: HeadCountToolProps) {
  const router = useRouter();
  const [space, setSpace] = useState<SpaceChoice>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<ReadingMetric | null>(null);

  const now = new Date();
  // Times render in the BROWSER only. `formatRecordedAt` reads the runtime's
  // locale and zone, so the server's render ("10:21 PM", or UTC on Vercel)
  // disagreed with the phone's ("10:21 p.m.", local) and React threw a
  // hydration error as soon as one reading existed. Same subscribe-don't-seed
  // idiom as DepartmentEditorShell's hash.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const recordedAt = (iso: string) => (hydrated ? formatRecordedAt(iso, now) : "…");

  const latestFor = (metric: ReadingMetric, spaceId: SpaceChoice) =>
    readings.find(
      (r) => r.metric === metric && (r.space_id ?? "") === spaceId
    ) ?? null;

  const lastCount = latestFor("headcount", space);

  // Seeded from the last count for THIS space, and re-seeded when the chip
  // changes. Held as a string so the field can be empty while someone types.
  const [countText, setCountText] = useState<string>(() =>
    lastCount ? String(Math.round(lastCount.value)) : "0"
  );
  const [seededFor, setSeededFor] = useState<SpaceChoice>(space);
  if (seededFor !== space && !busy) {
    setSeededFor(space);
    setCountText(String(Math.round(latestFor("headcount", space)?.value ?? 0)));
    setError(null);
  }

  const count = Number(countText === "" ? NaN : countText);
  const countValid = Number.isInteger(count) && count >= 0 && count <= METRICS.headcount.max;

  const capacity = space ? (spaces.find((s) => s.id === space)?.capacity ?? null) : null;

  async function record(metric: ReadingMetric, value: number) {
    setBusy(metric);
    setError(null);
    const res = await fetch(`/api/facilities/${facilityId}/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric, value, space_id: space || null }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save that. Try again.");
      return;
    }
    // `cacheComponents` keeps this component mounted across navigations, so a
    // "Saving…" left in state comes back stuck — see components/facility/
    // FacilityForm.tsx. Clearing it here is not optional.
    setJustSaved(metric);
    setTimeout(() => setJustSaved(null), 2500);
    router.refresh();
  }

  async function remove(reading: FacilityReading) {
    setBusy(reading.id);
    setError(null);
    const res = await fetch(`/api/facilities/${facilityId}/readings/${reading.id}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not delete that.");
      return;
    }
    router.refresh();
  }

  const bump = (by: number) =>
    setCountText(String(Math.max(0, (Number.isFinite(count) ? count : 0) + by)));

  const spaceLabel = space ? (spaces.find((s) => s.id === space)?.name ?? "") : "the whole building";

  return (
    <div className="space-y-6">
      {error && (
        <Banner variant="error">
          {error}
        </Banner>
      )}

      {/* ── Where ───────────────────────────────────────────────────────── */}
      {spaces.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Where</p>
          {/* Scrolls sideways rather than wrapping into a tall block — the
              count field has to stay on screen with it. */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {[{ id: "", name: "Whole building", capacity: null }, ...spaces].map((s) => (
              <button
                key={s.id || "facility"}
                type="button"
                onClick={() => setSpace(s.id)}
                aria-pressed={space === s.id}
                className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  space === s.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card text-foreground hover:bg-muted"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── How many ────────────────────────────────────────────────────── */}
      <div className="rounded-card border border-border bg-card p-5 shadow-card">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <label htmlFor="count" className="flex items-center gap-2 text-card-title text-foreground">
            <Users className="size-4 text-muted-foreground" aria-hidden />
            People in {spaceLabel}
          </label>
          {justSaved === "headcount" && (
            <span role="status" className="flex items-center gap-1 text-sm font-medium text-success">
              <Check className="size-4" aria-hidden /> Saved
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* 56px targets. The 44px minimum is for a dry index finger; this is
              used with wet hands, often through a glove. */}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => bump(-1)}
            disabled={!canWrite || count <= 0}
            aria-label="One fewer"
            className="size-14 disabled:opacity-40"
          >
            <Minus className="size-6" aria-hidden />
          </Button>

          <Input
            id="count"
            // `inputMode` rather than `type="number"`: a numeric keypad with no
            // spinner, and no scroll-wheel changing the value by accident.
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={countText}
            disabled={!canWrite}
            onChange={(e) => setCountText(e.target.value.replace(/[^0-9]/g, ""))}
            onFocus={(e) => e.currentTarget.select()}
            className="h-auto w-auto flex-1 rounded-card py-3 text-center text-4xl font-semibold tabular-nums md:text-4xl"
          />

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => bump(1)}
            disabled={!canWrite}
            aria-label="One more"
            className="size-14 disabled:opacity-40"
          >
            <Plus className="size-6" aria-hidden />
          </Button>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {[5, 10, 25].map((by) => (
            <Button
              key={by}
              type="button"
              variant="outline"
              onClick={() => bump(by)}
              disabled={!canWrite}
              className="h-11 tabular-nums disabled:opacity-40"
            >
              +{by}
            </Button>
          ))}
          {capacity != null && (
            <span className="ml-auto self-center text-xs text-muted-foreground">
              Capacity {capacity}
            </span>
          )}
        </div>

        <Button
          type="button"
          size="lg"
          onClick={() => record("headcount", count)}
          disabled={!canWrite || !countValid || busy === "headcount"}
          className="mt-4 h-13 w-full text-base"
        >
          {busy === "headcount" ? "Saving…" : "Record count"}
        </Button>

        {lastCount && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Last count {Math.round(lastCount.value)} at {recordedAt(lastCount.recorded_at)}
            {hydrated && !isFresh("headcount", lastCount.recorded_at, now) && " — out of date"}
          </p>
        )}
      </div>

      {/* ── Temperatures ────────────────────────────────────────────────── */}
      <TemperatureCard
        disabled={!canWrite}
        busy={busy}
        justSaved={justSaved}
        latest={{
          water_temp_c: latestFor("water_temp_c", space),
          air_temp_c: latestFor("air_temp_c", space),
        }}
        recordedAt={recordedAt}
        onRecord={record}
      />

      {/* ── The log ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-heading text-foreground">Recent entries</h2>
        {readings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded here yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
            {readings.map((r) => {
              const mine = r.recorded_by === viewerId;
              const who = mine ? "you" : (recorderNames[r.recorded_by ?? ""] ?? "a colleague");
              const where = r.space_id
                ? (spaces.find((s) => s.id === r.space_id)?.name ?? "a space")
                : "whole building";
              return (
                <li key={r.id} className="flex min-h-12 items-center gap-3 px-4 py-1.5 text-sm">
                  <span className="w-20 shrink-0 font-semibold tabular-nums">
                    {formatReading(r.metric, r.value)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {METRICS[r.metric].label} · {where} · {recordedAt(r.recorded_at)} · {who}
                  </span>
                  {canWrite && (mine || canManage) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(r)}
                      disabled={busy === r.id}
                      aria-label="Delete this entry"
                      title="For a typo. A count that was right at the time should stay — record a new one instead."
                      className="-mr-2 size-11 text-muted-foreground hover:text-destructive disabled:opacity-40"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Water and air, in one compact card.
 *
 * Secondary to the count on purpose — a temperature is taken a couple of times
 * a shift and a head count every half hour, so this sits below and does not
 * get the 56px treatment.
 */
function TemperatureCard({
  disabled,
  busy,
  justSaved,
  latest,
  recordedAt,
  onRecord,
}: {
  disabled: boolean;
  busy: string | null;
  justSaved: ReadingMetric | null;
  latest: Record<"water_temp_c" | "air_temp_c", FacilityReading | null>;
  recordedAt: (iso: string) => string;
  onRecord: (metric: ReadingMetric, value: number) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <div className="rounded-card border border-border bg-card p-5 shadow-card">
      <p className="mb-3 flex items-center gap-2 text-card-title text-foreground">
        <Thermometer className="size-4 text-muted-foreground" aria-hidden />
        Temperature
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["water_temp_c", "air_temp_c"] as const).map((metric) => {
          const spec = METRICS[metric];
          const text = values[metric] ?? "";
          const value = Number(text);
          const valid = text !== "" && Number.isFinite(value) && value >= spec.min && value <= spec.max;
          const last = latest[metric];

          return (
            // min-w-0: a grid item defaults to min-width:auto, so the input's
            // intrinsic ~20ch pushed Save past the card edge on a 390px phone.
            <div key={metric} className="min-w-0">
              <label htmlFor={metric} className="mb-1.5 block text-caption font-medium text-foreground">
                {spec.label} (°C)
              </label>
              <div className="flex gap-2">
                <Input
                  id={metric}
                  type="text"
                  inputMode="decimal"
                  value={text}
                  disabled={disabled}
                  placeholder={last ? String(last.value) : "27.5"}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [metric]: e.target.value.replace(/[^0-9.-]/g, "") }))
                  }
                  className="h-11 w-auto flex-1 text-center text-lg tabular-nums md:text-lg"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || !valid || busy === metric}
                  onClick={() => {
                    onRecord(metric, value);
                    setValues((v) => ({ ...v, [metric]: "" }));
                  }}
                  className="h-11 shrink-0 disabled:opacity-40"
                >
                  {busy === metric ? "…" : justSaved === metric ? "✓" : "Save"}
                </Button>
              </div>
              {last && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatReading(metric, last.value)} at {recordedAt(last.recorded_at)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** For `useSyncExternalStore`: a store that never changes, read only to tell server from client. */
function subscribeNever() {
  return () => {};
}
