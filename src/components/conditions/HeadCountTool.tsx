"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, Thermometer, Trash2, Users } from "lucide-react";
import {
  METRICS,
  formatReading,
  formatRecordedAt,
  isFresh,
} from "@/lib/conditions/readings";
import type { FacilityReading, ReadingMetric } from "@/types/app.types";

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
}: HeadCountToolProps) {
  const router = useRouter();
  const [space, setSpace] = useState<SpaceChoice>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<ReadingMetric | null>(null);

  const now = new Date();

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
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
        >
          {error}
        </p>
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
                className={`shrink-0 rounded-full border px-4 py-2 text-sm transition-colors ${
                  space === s.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border hover:bg-muted"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── How many ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <label htmlFor="count" className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4 text-muted-foreground" aria-hidden />
            People in {spaceLabel}
          </label>
          {justSaved === "headcount" && (
            <span role="status" className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
              <Check className="size-4" aria-hidden /> Saved
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* 56px targets. The 44px minimum is for a dry index finger; this is
              used with wet hands, often through a glove. */}
          <button
            type="button"
            onClick={() => bump(-1)}
            disabled={!canWrite || count <= 0}
            aria-label="One fewer"
            className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-border text-foreground hover:bg-muted disabled:opacity-40"
          >
            <Minus className="size-6" aria-hidden />
          </button>

          <input
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
            className="min-w-0 flex-1 rounded-xl border border-border py-3 text-center text-4xl font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          />

          <button
            type="button"
            onClick={() => bump(1)}
            disabled={!canWrite}
            aria-label="One more"
            className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-border text-foreground hover:bg-muted disabled:opacity-40"
          >
            <Plus className="size-6" aria-hidden />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {[5, 10, 25].map((by) => (
            <button
              key={by}
              type="button"
              onClick={() => bump(by)}
              disabled={!canWrite}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              +{by}
            </button>
          ))}
          {capacity != null && (
            <span className="ml-auto self-center text-xs text-muted-foreground">
              Capacity {capacity}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => record("headcount", count)}
          disabled={!canWrite || !countValid || busy === "headcount"}
          className="mt-4 w-full rounded-xl bg-foreground py-3.5 text-base font-medium text-background disabled:opacity-50"
        >
          {busy === "headcount" ? "Saving…" : "Record count"}
        </button>

        {lastCount && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Last count {Math.round(lastCount.value)} at {formatRecordedAt(lastCount.recorded_at, now)}
            {!isFresh("headcount", lastCount.recorded_at, now) && " — out of date"}
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
        now={now}
        onRecord={record}
      />

      {/* ── The log ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Recent entries</h2>
        {readings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded here yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {readings.map((r) => {
              const mine = r.recorded_by === viewerId;
              const who = mine ? "you" : (recorderNames[r.recorded_by ?? ""] ?? "a colleague");
              const where = r.space_id
                ? (spaces.find((s) => s.id === r.space_id)?.name ?? "a space")
                : "whole building";
              return (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="w-20 shrink-0 font-semibold tabular-nums">
                    {formatReading(r.metric, r.value)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {METRICS[r.metric].label} · {where} · {formatRecordedAt(r.recorded_at, now)} · {who}
                  </span>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={busy === r.id}
                      aria-label="Delete this entry"
                      title="For a typo. A count that was right at the time should stay — record a new one instead."
                      className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
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
  now,
  onRecord,
}: {
  disabled: boolean;
  busy: string | null;
  justSaved: ReadingMetric | null;
  latest: Record<"water_temp_c" | "air_temp_c", FacilityReading | null>;
  now: Date;
  onRecord: (metric: ReadingMetric, value: number) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-medium">
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
            <div key={metric}>
              <label htmlFor={metric} className="mb-1 block text-xs text-muted-foreground">
                {spec.label} (°C)
              </label>
              <div className="flex gap-2">
                <input
                  id={metric}
                  type="text"
                  inputMode="decimal"
                  value={text}
                  disabled={disabled}
                  placeholder={last ? String(last.value) : "27.5"}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [metric]: e.target.value.replace(/[^0-9.-]/g, "") }))
                  }
                  className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2.5 text-center text-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={disabled || !valid || busy === metric}
                  onClick={() => {
                    onRecord(metric, value);
                    setValues((v) => ({ ...v, [metric]: "" }));
                  }}
                  className="shrink-0 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-40"
                >
                  {busy === metric ? "…" : justSaved === metric ? "✓" : "Save"}
                </button>
              </div>
              {last && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatReading(metric, last.value)} at {formatRecordedAt(last.recorded_at, now)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
