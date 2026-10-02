"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ChevronDown, Clock, Minus, Plus, Thermometer, Undo2 } from "lucide-react";
import {
  METRICS,
  formatReading,
  formatRecordedAt,
  isFresh,
} from "@/lib/conditions/readings";
import type { FacilityReading, ReadingMetric } from "@/types/app.types";
import type { ExpandedSession } from "@/types/schedule.types";
import { useWeeklySchedule } from "@/hooks/useScheduleRange";
import {
  formatSessionTime,
  getWeekStart,
  minutesOfDayIn,
  nowAsSessionTime,
  sessionDateString,
} from "@/lib/utils/dates";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";

/**
 * The tool a lifeguard uses on deck — and, since 2026-09-29, everyone else:
 * it is the "People here" section of the facility status page, not a page of
 * its own, because "head counts" was lifeguard language and logging how many
 * people are in the building is a status question.
 *
 * ## Where, what and when (2026-10-01)
 *
 * A count says three things besides the number: the space (chips), the
 * session it was taken during (migration 069), and the time. All three
 * default to the common case — whole facility, no session, now — so the
 * fifteen-second version is still: bump, Record.
 *
 * Since the second pass the same day, all three are dropdowns inside the one
 * card, under the number, rather than three rows of chips above it: with a
 * dozen spaces the chips pushed the stepper and Record below the fold on a
 * phone.
 *
 * - **Every space is offered, published or not.** The picker used to show
 *   published spaces only, so a facility whose spaces were all unpublished
 *   (Panorama: ten, none published) had no picker at all. Publishing decides
 *   what patrons see; staff count in the back rooms too.
 * - **Sessions are today's, already started, in the chosen space**, from the
 *   same schedule fetch the Overview's today strip uses. The ones on at the
 *   chosen time come first; the rest of the morning folds behind a toggle.
 *   Nothing is preselected — a count filed under the wrong program is worse
 *   than one filed under none.
 * - **Time is Now, or Earlier today** (a count taken on paper and typed in
 *   at ten past). Picking a session that has already ended moves the time to
 *   its start, so the pair always agrees.
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
 * There is no edit. The log of past counts lives in Analytics › Attendance
 * (the user's call, 2026-10-01: history belongs with the analysis, not on the
 * page someone opens at 6am). What stays here is Undo on the entry you just
 * made — the typo case, caught while the phone is still in your hand.
 */

interface Space {
  id: string;
  name: string;
  capacity: number | null;
  department_id?: string | null;
}

interface Department {
  id: string;
  name: string;
}

export interface HeadCountToolProps {
  orgId: string;
  facilityId: string;
  spaces: Space[];
  /** For grouping the Where picker; spaces outside any listed department go first. */
  departments?: Department[];
  /** The newest readings, newest first, from the server — for "Last count". */
  readings: FacilityReading[];
  canWrite: boolean;
}

/** "" = the whole building, which is also the default. */
type SpaceChoice = string;

export default function HeadCountTool({
  orgId,
  facilityId,
  spaces,
  departments = [],
  readings,
  canWrite,
}: HeadCountToolProps) {
  const router = useRouter();
  const [space, setSpace] = useState<SpaceChoice>("");
  const [sessionId, setSessionId] = useState<string>("");
  /** "" = now. Otherwise "HH:MM" today, local. */
  const [earlierAt, setEarlierAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<ReadingMetric | null>(null);
  /** The entry this person just made, for Undo. Cleared once undone. */
  const [lastSaved, setLastSaved] = useState<FacilityReading | null>(null);

  const now = new Date();
  // Times render in the BROWSER only. `formatRecordedAt` reads the runtime's
  // locale and zone, so the server's render ("10:21 PM", or UTC on Vercel)
  // disagreed with the phone's ("10:21 p.m.", local) and React threw a
  // hydration error as soon as one reading existed. Same subscribe-don't-seed
  // idiom as DepartmentEditorShell's hash.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const recordedAt = (iso: string) => (hydrated ? formatRecordedAt(iso, now) : "…");

  // ── Today's sessions ────────────────────────────────────────────────────
  // The whole week is fetched (that is the hook's unit, and the cache it
  // shares with the Overview); "starts today" is the filter, as in TodayStrip.
  const { weekStart, todayKey } = useMemo(
    () => ({
      weekStart: getWeekStart(new Date()),
      todayKey: sessionDateString(nowAsSessionTime()),
    }),
    []
  );
  const { data: weekSessions, isPending: sessionsPending } = useWeeklySchedule({
    orgId,
    facilityId,
    weekStart,
  });

  // The chosen time in minutes of the day, in the session convention.
  const atMin = earlierAt ? hhmmToMinutes(earlierAt) : minutesOfDayIn(nowAsSessionTime());

  const todaySessions = useMemo(() => {
    const seen = new Set<string>();
    const out: ExpandedSession[] = [];
    for (const s of weekSessions ?? []) {
      if (sessionDateString(s.start) !== todayKey) continue;
      // residual.ts can split one block into bands with the same session id.
      if (seen.has(s.sessionId)) continue;
      seen.add(s.sessionId);
      out.push(s);
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [weekSessions, todayKey]);

  const nowMin = minutesOfDayIn(nowAsSessionTime());
  const sessionChoices = todaySessions.filter(
    (s) =>
      // Not yet started: nobody can have counted it.
      minutesOfDayIn(s.start) <= nowMin &&
      // In the chosen space — a whole-facility count may name any session.
      (!space || s.spaceIds.includes(space))
  );
  const onAtTime = (s: ExpandedSession) => {
    const start = minutesOfDayIn(s.start);
    const rawEnd = minutesOfDayIn(s.end);
    const end = rawEnd < start ? 24 * 60 : rawEnd;
    return start <= atMin && atMin < end;
  };
  const sessionsOn = sessionChoices.filter(onAtTime);
  const sessionsOther = sessionChoices.filter((s) => !onAtTime(s));
  const selectedSession = todaySessions.find((s) => s.sessionId === sessionId) ?? null;

  // A session picked, then the space changed to one it does not use: the pair
  // would contradict itself, so the session goes.
  if (sessionId && space && selectedSession && !selectedSession.spaceIds.includes(space)) {
    setSessionId("");
  }

  function pickSession(s: ExpandedSession | null) {
    if (!s || s.sessionId === sessionId) {
      setSessionId("");
      return;
    }
    setSessionId(s.sessionId);
    // A session that has already finished was counted while it ran, not now.
    if (!onAtTime(s)) setEarlierAt(minutesToHhmm(minutesOfDayIn(s.start)));
    // A one-space session names the space too; a multi-space one leaves it.
    if (!space && s.spaceIds.length === 1 && spaces.some((sp) => sp.id === s.spaceIds[0])) {
      setSpace(s.spaceIds[0]);
    }
  }

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

  // "Earlier" must be earlier: a time later than now is a typo, and the API
  // refuses it anyway — better to say so before the tap.
  const earlierInFuture = earlierAt != null && hhmmToMinutes(earlierAt) > nowMin;
  const timeValid = earlierAt == null || (/^\d{2}:\d{2}$/.test(earlierAt) && !earlierInFuture);

  async function record(metric: ReadingMetric, value: number) {
    setBusy(metric);
    setError(null);
    const res = await fetch(`/api/facilities/${facilityId}/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metric,
        value,
        space_id: space || null,
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(earlierAt ? { recorded_at: localTodayAt(earlierAt).toISOString() } : {}),
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save that. Try again.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    // `cacheComponents` keeps this component mounted across navigations, so a
    // "Saving…" left in state comes back stuck — see components/facility/
    // FacilityForm.tsx. Clearing it here is not optional.
    setJustSaved(metric);
    setLastSaved(body.reading ?? null);
    setTimeout(() => setJustSaved(null), 2500);
    // Back to "now" for the next one; the space and session stay, because the
    // next count is usually the same place half an hour later.
    setEarlierAt(null);
    router.refresh();
  }

  async function undo(reading: FacilityReading) {
    setBusy(reading.id);
    setError(null);
    const res = await fetch(`/api/facilities/${facilityId}/readings/${reading.id}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not undo that.");
      return;
    }
    setLastSaved(null);
    router.refresh();
  }

  const bump = (by: number) =>
    setCountText(String(Math.max(0, (Number.isFinite(count) ? count : 0) + by)));

  const spaceLabel = space ? (spaces.find((s) => s.id === space)?.name ?? "") : "the whole facility";

  // Spaces grouped under their department, in the order they came (the Spaces
  // page order). A facility with ten lanes and two courts is a dropdown, not
  // two rows of chips that push the number off a phone screen.
  const spaceGroups = groupSpaces(spaces, departments);

  return (
    <div className="space-y-4">
      {error && <Banner variant="error">{error}</Banner>}

      <div className="rounded-card border border-border bg-card p-5 shadow-card">
        {/* ── Where ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="count-where" className="text-card-title text-foreground">
            Count people
          </label>
          {justSaved === "headcount" && (
            <span role="status" className="flex items-center gap-1 text-sm font-medium text-success">
              <Check className="size-4" aria-hidden /> Saved
            </span>
          )}
        </div>

        {spaces.length > 0 && (
          <NativeSelect
            id="count-where"
            aria-label="Where"
            value={space}
            onChange={(e) => setSpace(e.target.value)}
            wrapperClassName="mt-3"
            className="h-11 text-base md:text-base"
          >
            <option value="">Whole facility</option>
            {spaceGroups.map((g) =>
              g.label ? (
                <optgroup key={g.key} label={g.label}>
                  {g.spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                g.spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )
            )}
          </NativeSelect>
        )}

        {/* ── How many ──────────────────────────────────────────────────── */}
        <div className="mt-4 flex items-center gap-3">
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
            aria-label={`People in ${spaceLabel}`}
            // `inputMode` rather than `type="number"`: a numeric keypad with no
            // spinner, and no scroll-wheel changing the value by accident.
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={countText}
            disabled={!canWrite}
            onChange={(e) => setCountText(e.target.value.replace(/[^0-9]/g, ""))}
            onFocus={(e) => e.currentTarget.select()}
            className="h-auto w-auto min-w-0 flex-1 rounded-card py-3 text-center text-4xl font-semibold tabular-nums md:text-4xl"
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

        <div className="mt-2 flex flex-wrap items-center gap-2">
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
            <span className="ml-auto text-xs text-muted-foreground">Capacity {capacity}</span>
          )}
        </div>

        {/* ── Session and time: optional, so quiet ──────────────────────── */}
        <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label
              htmlFor="count-session"
              className="mb-1.5 flex items-center gap-1.5 text-caption font-medium text-foreground"
            >
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
              Session
            </label>
            <NativeSelect
              id="count-session"
              value={sessionId}
              disabled={!canWrite || sessionsPending || sessionChoices.length === 0}
              onChange={(e) =>
                pickSession(todaySessions.find((s) => s.sessionId === e.target.value) ?? null)
              }
              className="h-11"
            >
              <option value="">
                {sessionsPending
                  ? "Loading…"
                  : sessionChoices.length === 0
                    ? todaySessions.length === 0
                      ? "Nothing scheduled today"
                      : "Nothing has started yet"
                    : "No session"}
              </option>
              {sessionsOn.length > 0 && (
                <optgroup label="On now">
                  {sessionsOn.map((s) => (
                    <option key={s.sessionId} value={s.sessionId}>
                      {sessionDisplayLabel(s)} · {formatSessionTime(s.start)}
                    </option>
                  ))}
                </optgroup>
              )}
              {sessionsOther.length > 0 && (
                <optgroup label="Earlier today">
                  {sessionsOther.map((s) => (
                    <option key={s.sessionId} value={s.sessionId}>
                      {sessionDisplayLabel(s)} · {formatSessionTime(s.start)}
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
          </div>

          <div className="min-w-0">
            <p className="mb-1.5 flex items-center gap-1.5 text-caption font-medium text-foreground">
              <Clock className="size-4 text-muted-foreground" aria-hidden />
              When
            </p>
            <div className="flex items-center gap-2">
              <Segmented
                label="When the count was taken"
                value={earlierAt == null ? "now" : "earlier"}
                disabled={!canWrite}
                onChange={(v) =>
                  setEarlierAt(
                    v === "now" ? null : (earlierAt ?? minutesToHhmm(Math.max(0, nowMin - 30)))
                  )
                }
                options={[
                  { value: "now", label: "Now" },
                  { value: "earlier", label: "Earlier" },
                ]}
              />
              {earlierAt != null && (
                <Input
                  type="time"
                  aria-label="Time of the count"
                  value={earlierAt}
                  max={minutesToHhmm(nowMin)}
                  disabled={!canWrite}
                  onChange={(e) => setEarlierAt(e.target.value)}
                  className="h-11 w-auto min-w-0 flex-1 tabular-nums"
                />
              )}
            </div>
            {earlierInFuture && (
              <p className="mt-1.5 text-sm text-destructive">That time hasn&rsquo;t happened yet.</p>
            )}
          </div>
        </div>

        <Button
          type="button"
          size="lg"
          onClick={() => record("headcount", count)}
          disabled={!canWrite || !countValid || !timeValid || busy === "headcount"}
          className="mt-5 h-13 w-full text-base"
        >
          {busy === "headcount" ? "Saving…" : "Record count"}
        </Button>

        {/* What will be filed, in one line, so a wrong pick is caught before
            the tap rather than in Analytics a month later. */}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {[
            space ? spaceLabel : "Whole facility",
            selectedSession ? sessionDisplayLabel(selectedSession) : null,
            earlierAt ? `at ${formatHhmm(earlierAt)}` : "now",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {lastSaved && lastSaved.metric === "headcount" ? (
          <p className="mt-1 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            Recorded {Math.round(lastSaved.value)} at {recordedAt(lastSaved.recorded_at)}
            <button
              type="button"
              onClick={() => undo(lastSaved)}
              disabled={busy === lastSaved.id}
              className="inline-flex min-h-8 items-center gap-1 rounded px-1.5 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <Undo2 className="size-3.5" aria-hidden />
              {busy === lastSaved.id ? "Undoing…" : "Undo"}
            </button>
          </p>
        ) : (
          lastCount && (
            <p className="mt-1 text-center text-xs text-muted-foreground">
              Last count {Math.round(lastCount.value)} at {recordedAt(lastCount.recorded_at)}
              {hydrated && !isFresh("headcount", lastCount.recorded_at, now) && " — out of date"}
            </p>
          )
        )}
      </div>

      {/* ── Temperatures ────────────────────────────────────────────────────
          Folded unless this facility has recorded one: water temperature is a
          pool thing, and since the tool moved onto the status page (which
          every department uses) a tennis coordinator should not meet it. A
          building that takes temperatures gets it open, as before. They are
          filed with the same space, session and time as a count. */}
      <Collapsible defaultOpen={readings.some((r) => r.metric !== "headcount")}>
        <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Thermometer className="size-4" aria-hidden />
          Water &amp; air temperature
          <ChevronDown
            className="size-4 transition-transform duration-150 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
      <TemperatureCard
        disabled={!canWrite || !timeValid}
        busy={busy}
        justSaved={justSaved}
        latest={{
          water_temp_c: latestFor("water_temp_c", space),
          air_temp_c: latestFor("air_temp_c", space),
        }}
        recordedAt={recordedAt}
        onRecord={record}
      />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** Spaces under their department's name, in the order given; unassigned first, unlabelled. */
function groupSpaces(spaces: Space[], departments: Department[]) {
  const loose = spaces.filter((s) => !departments.some((d) => d.id === s.department_id));
  return [
    { key: "loose", label: null as string | null, spaces: loose },
    ...departments.map((d) => ({
      key: d.id,
      label: d.name as string | null,
      spaces: spaces.filter((s) => s.department_id === d.id),
    })),
  ].filter((g) => g.spaces.length > 0);
}

/** "14:05" → 845. */
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 845 → "14:05", the value an `<input type="time">` takes. */
function minutesToHhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "14:05" → "2:05 PM", through the session formatter so it matches the chips. */
function formatHhmm(hhmm: string): string {
  const min = hhmmToMinutes(hhmm);
  return formatSessionTime(new Date(Date.UTC(2000, 0, 1, Math.floor(min / 60), min % 60)));
}

/**
 * Today at a wall-clock time, as a real instant. Local getters on purpose:
 * `recorded_at` is a true timestamp (unlike a session's UTC-labelled digits),
 * and "14:05" means 14:05 where the phone is.
 */
function localTodayAt(hhmm: string): Date {
  const d = new Date();
  const min = hhmmToMinutes(hhmm);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d;
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
