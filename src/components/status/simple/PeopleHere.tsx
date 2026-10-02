"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Minus, Plus } from "lucide-react";
import { METRICS, formatReading, formatRecordedAt, isFresh } from "@/lib/conditions/readings";
import type { FacilityReading, ReadingMetric } from "@/types/app.types";
import type { ExpandedSession } from "@/types/schedule.types";
import { useWeeklySchedule } from "@/hooks/useScheduleRange";
import { getWeekStart, minutesOfDayIn, nowAsSessionTime, sessionDateString } from "@/lib/utils/dates";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * "People here" and "Temperature", the simple version.
 *
 * Counting is: pick where, − / +, Record. Session and time are not asked:
 * the count is stamped now, and when exactly one session is running in that
 * place it is attached automatically (migration 069) and named under the
 * button, so Attendance still knows what was counted. Anything else — an
 * earlier time, a different session — is what the full history in Analytics ›
 * Attendance is for.
 *
 * Temperatures are two rows, water and air: the latest value and when. Tap
 * one to log a new reading.
 */

interface Space {
  id: string;
  name: string;
}

export interface PeopleHereProps {
  orgId: string;
  facilityId: string;
  spaces: Space[];
  readings: FacilityReading[];
  canWrite: boolean;
}

export default function PeopleHere({ orgId, facilityId, spaces, readings, canWrite }: PeopleHereProps) {
  const router = useRouter();
  const [space, setSpace] = useState(""); // "" = whole facility
  const latest = (metric: ReadingMetric, spaceId: string | null) =>
    readings.find((r) => r.metric === metric && (spaceId === null || (r.space_id ?? "") === spaceId)) ?? null;

  const [count, setCount] = useState(() => Math.round(latest("headcount", "")?.value ?? 0));
  const [seededFor, setSeededFor] = useState(space);
  if (seededFor !== space) {
    setSeededFor(space);
    setCount(Math.round(latest("headcount", space)?.value ?? 0));
  }

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<FacilityReading | null>(null);
  const [editing, setEditing] = useState<ReadingMetric | null>(null);
  const [tempText, setTempText] = useState("");

  const now = new Date();
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const at = (iso: string) => (hydrated ? formatRecordedAt(iso, now) : "");

  // ── The one session running here now, if exactly one ────────────────────
  const weekStart = useMemo(() => getWeekStart(new Date()), []);
  const { data: weekSessions } = useWeeklySchedule({ orgId, facilityId, weekStart });
  const nowMin = minutesOfDayIn(nowAsSessionTime());
  const todayKey = sessionDateString(nowAsSessionTime());
  const onNow = useMemo(() => {
    const seen = new Set<string>();
    const out: ExpandedSession[] = [];
    for (const s of weekSessions ?? []) {
      if (sessionDateString(s.start) !== todayKey || seen.has(s.sessionId)) continue;
      const start = minutesOfDayIn(s.start);
      const rawEnd = minutesOfDayIn(s.end);
      const end = rawEnd < start ? 24 * 60 : rawEnd;
      if (start <= nowMin && nowMin < end && (!space || s.spaceIds.includes(space))) {
        seen.add(s.sessionId);
        out.push(s);
      }
    }
    return out;
  }, [weekSessions, todayKey, nowMin, space]);
  const session = onNow.length === 1 ? onNow[0] : null;

  async function post(metric: ReadingMetric, value: number, spaceId: string | null, sessionId?: string) {
    setBusy(metric);
    setError(null);
    const res = await fetch(`/api/facilities/${facilityId}/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric, value, space_id: spaceId, ...(sessionId ? { session_id: sessionId } : {}) }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "That didn't save. Try again.");
      return { ok: false as const, reading: null };
    }
    const body = await res.json().catch(() => ({}));
    router.refresh();
    return { ok: true as const, reading: (body.reading ?? null) as FacilityReading | null };
  }

  async function record() {
    const result = await post("headcount", count, space || null, session?.sessionId);
    if (result.ok) setSaved(result.reading ?? ({ id: "", value: count } as FacilityReading));
  }

  async function undo() {
    if (!saved?.id) return;
    setBusy("undo");
    const res = await fetch(`/api/facilities/${facilityId}/readings/${saved.id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      setSaved(null);
      router.refresh();
    }
  }

  async function saveTemp(metric: ReadingMetric) {
    const value = Number(tempText);
    const spec = METRICS[metric];
    if (tempText.trim() === "" || !Number.isFinite(value) || value < spec.min || value > spec.max) {
      setError(`Enter a temperature between ${spec.min} and ${spec.max} °C.`);
      return;
    }
    const prev = latest(metric, null);
    if ((await post(metric, value, prev?.space_id ?? null)).ok) {
      setEditing(null);
      setTempText("");
    }
  }

  const last = latest("headcount", space);
  const lastLine = last
    ? `Last count ${formatReading("headcount", last.value)} · ${at(last.recorded_at)}${
        hydrated && !isFresh("headcount", last.recorded_at, now) ? " · out of date" : ""
      }`
    : "No count yet";

  return (
    <div className="space-y-8">
      {error && <Banner variant="error">{error}</Banner>}

      {canWrite && (
        <section aria-labelledby="people-here">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 id="people-here" className="text-heading text-foreground">
              People here
            </h2>
            <span className="text-caption text-muted-foreground tabular-nums">{lastLine}</span>
          </div>
          <div className="space-y-3.5 rounded-card border border-border bg-card p-4 shadow-card">
            <NativeSelect aria-label="Where" value={space} onChange={(e) => { setSpace(e.target.value); setSaved(null); }}>
              <option value="">Whole facility</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>

            <div className="grid grid-cols-[56px_minmax(0,1fr)_56px] items-center gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="size-14 rounded-full"
                aria-label="One fewer"
                onClick={() => { setCount((c) => Math.max(0, c - 1)); setSaved(null); }}
              >
                <Minus className="size-5" aria-hidden />
              </Button>
              <input
                aria-label="People"
                inputMode="numeric"
                value={count}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, ""));
                  setCount(Number.isFinite(n) ? Math.min(n, METRICS.headcount.max) : 0);
                  setSaved(null);
                }}
                className="h-18 w-full rounded-card border border-input bg-card text-center text-[40px] leading-none font-semibold tracking-[-0.03em] tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="button"
                variant="outline"
                className="size-14 rounded-full"
                aria-label="One more"
                onClick={() => { setCount((c) => Math.min(METRICS.headcount.max, c + 1)); setSaved(null); }}
              >
                <Plus className="size-5" aria-hidden />
              </Button>
            </div>

            <Button type="button" size="lg" className="w-full" disabled={busy !== null} onClick={record}>
              {busy === "headcount" ? "Saving…" : saved ? "Saved" : "Record count"}
            </Button>

            {saved ? (
              <p className="text-center text-caption text-muted-foreground">
                Recorded {formatReading("headcount", saved.value)}
                {session ? ` during ${sessionDisplayLabel(session)}` : ""}.{" "}
                {saved.id && (
                <button type="button" onClick={undo} disabled={busy !== null} className="font-medium text-brand hover:underline underline-offset-4">
                  Undo
                </button>
                )}
              </p>
            ) : (
              session && (
                <p className="text-center text-caption text-muted-foreground">During {sessionDisplayLabel(session)}</p>
              )
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="temperature">
        <h2 id="temperature" className="mb-2 text-heading text-foreground">
          Temperature
        </h2>
        <ul className="overflow-hidden rounded-card border border-border bg-card shadow-card">
          {(["water_temp_c", "air_temp_c"] as const).map((metric) => {
            const r = latest(metric, null);
            const label = metric === "water_temp_c" ? "Water" : "Air";
            const stale = r && hydrated && !isFresh(metric, r.recorded_at, now);
            return (
              <li key={metric} className="border-t border-border first:border-t-0">
                {editing === metric ? (
                  <form
                    className="flex min-h-13 items-center gap-3 px-4 py-2.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveTemp(metric);
                    }}
                  >
                    <label htmlFor={`t-${metric}`} className="text-body font-medium text-foreground">
                      {label}
                    </label>
                    <Input
                      id={`t-${metric}`}
                      autoFocus
                      inputMode="decimal"
                      placeholder={r ? String(r.value) : "°C"}
                      value={tempText}
                      onChange={(e) => setTempText(e.target.value)}
                      className="ml-auto w-24 text-right"
                    />
                    <span className="text-caption text-muted-foreground">°C</span>
                    <Button type="submit" size="sm" disabled={busy !== null}>
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => {
                      setEditing(metric);
                      setTempText("");
                      setError(null);
                    }}
                    className="flex min-h-13 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 enabled:hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="text-body font-medium text-foreground">{label}</span>
                    <span className="ml-auto text-body tabular-nums text-foreground">
                      {r ? formatReading(metric, r.value) : "—"}
                    </span>
                    <span className={stale ? "text-caption text-warning" : "text-caption text-muted-foreground"}>
                      {r ? at(r.recorded_at) : "Not logged"}
                    </span>
                    {canWrite && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function subscribeNever() {
  return () => {};
}
