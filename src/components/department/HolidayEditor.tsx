"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, RotateCcw } from "lucide-react";
import {
  suggestedHolidays,
  selectableYears,
  type SuggestedHoliday,
} from "@/lib/schedule/holiday-catalogue";
import { timeToMinutes } from "@/lib/schedule/operating-hours";
import { InfoTip } from "@/components/ui/info-tip";
import { useSectionDirty } from "@/components/department/section-dirty";
import { cn } from "@/lib/utils/cn";

type Observance = "closed" | "custom_hours" | "normal_hours";

interface DraftWindow {
  opens: string;
  closes: string;
}

/** One row of the checklist: a date, what staff decided, and the hours if the
 *  decision needs them. `observed` false means no row is saved at all. */
interface HolidayRow {
  date: string;
  name: string;
  observed: boolean;
  observance: Observance;
  windows: DraftWindow[];
  /** Present when the row came from the catalogue rather than being typed. */
  kind?: "statutory" | "common";
  note?: string;
  /** True for a date staff added themselves, so it can be removed entirely
   *  rather than just unticked. */
  custom: boolean;
}

export interface SavedHoliday {
  date: string;
  name: string;
  observance: Observance;
  windows: DraftWindow[];
}

interface HolidayEditorProps {
  departmentId: string;
  /** From the parent facility, to pick the right statutory list. */
  province: string | null;
  /** The year the server rendered, and that year's saved decisions. */
  initialYear: number;
  initialHolidays: SavedHoliday[];
  /** Other departments at the same facility, for the copy action. */
  siblings: { id: string; name: string }[];
}

const DEFAULT_WINDOW: DraftWindow = { opens: "10:00", closes: "16:00" };

const OBSERVANCE_LABELS: Record<Observance, string> = {
  closed: "Closed all day",
  custom_hours: "Open, different hours",
  normal_hours: "Open as usual",
};

/**
 * Merges a year's catalogue suggestions with whatever is already saved.
 *
 * Saved rows win on every field — a date staff have already answered must come
 * back exactly as they left it, even if the catalogue later changes its mind
 * about the name or whether the day is statutory. Suggestions only fill in the
 * dates nobody has answered yet, and arrive unticked.
 */
function buildRows(suggestions: SuggestedHoliday[], saved: SavedHoliday[]): HolidayRow[] {
  const savedByDate = new Map(saved.map((h) => [h.date, h]));
  const rows: HolidayRow[] = [];

  for (const s of suggestions) {
    const hit = savedByDate.get(s.date);
    savedByDate.delete(s.date);
    rows.push({
      date: s.date,
      name: hit?.name ?? s.name,
      observed: !!hit,
      observance: hit?.observance ?? "closed",
      windows: hit?.windows.length ? hit.windows : [DEFAULT_WINDOW],
      kind: s.kind,
      note: s.note,
      custom: false,
    });
  }

  // Anything saved that the catalogue does not know about — a civic day, a
  // maintenance shutdown, or a suggestion from a year the rules have since
  // changed. Kept and marked custom so it can be removed outright.
  for (const h of savedByDate.values()) {
    rows.push({
      date: h.date,
      name: h.name,
      observed: true,
      observance: h.observance,
      windows: h.windows.length ? h.windows : [DEFAULT_WINDOW],
      custom: true,
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** "Fri 25 Dec" — enough to see which day of the week a holiday lands on,
 *  which is most of what decides whether a centre bothers opening. Built with
 *  UTC getters on a date-only string, so it cannot drift a day. */
function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-CA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "January" — the group heading. Same UTC reasoning as formatDate. */
function monthLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-CA", {
    month: "long",
    timeZone: "UTC",
  });
}

export default function HolidayEditor({
  departmentId,
  province,
  initialYear,
  initialHolidays,
  siblings,
}: HolidayEditorProps) {
  const router = useRouter();
  const years = useMemo(() => selectableYears(), []);
  const [year, setYear] = useState(initialYear);
  const [rows, setRows] = useState<HolidayRow[]>(() =>
    buildRows(suggestedHolidays(province, initialYear), initialHolidays)
  );
  /** The decisions the server currently holds for `year` — what Discard
   *  returns to, and what "unsaved" is measured against. */
  const [savedHolidays, setSavedHolidays] = useState<SavedHoliday[]>(initialHolidays);
  const [loadingYear, setLoadingYear] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [onlyObserved, setOnlyObserved] = useState(false);

  const dirty =
    snapshot(rows) !== snapshot(buildRows(suggestedHolidays(province, year), savedHolidays));
  useSectionDirty("holidays", dirty);

  function mutate(index: number, patch: Partial<HolidayRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSaved(null);
  }

  /** Switching year refetches, because a year's decisions are only ever loaded
   *  one at a time — the alternative is shipping three years of rows to a page
   *  that shows one. */
  async function changeYear(next: number) {
    setLoadingYear(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`/api/departments/${departmentId}/holidays?year=${next}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not load that year.");
        return;
      }
      const loaded: SavedHoliday[] = json.holidays ?? [];
      setYear(next);
      setSavedHolidays(loaded);
      setRows(buildRows(suggestedHolidays(province, next), loaded));
    } finally {
      setLoadingYear(false);
    }
  }

  function addCustom() {
    setRows((prev) =>
      [
        ...prev,
        {
          date: `${year}-01-01`,
          name: "",
          observed: true,
          observance: "closed" as Observance,
          windows: [DEFAULT_WINDOW],
          custom: true,
        },
      ].sort((a, b) => a.date.localeCompare(b.date))
    );
    setOnlyObserved(false);
    setSaved(null);
  }

  /** Ticks every statutory suggestion at once, as closed. A centre that
   *  closes for the statutory days and nothing else is the common answer, and
   *  it was twelve separate ticks. Days already answered are left exactly as
   *  they are — this only fills in the blanks. */
  function observeAllStatutory() {
    setRows((prev) =>
      prev.map((r) => (r.kind === "statutory" && !r.observed ? { ...r, observed: true } : r))
    );
    setSaved(null);
  }

  function clearAll() {
    setRows((prev) => prev.map((r) => (r.observed ? { ...r, observed: false } : r)));
    setSaved(null);
  }

  function discard() {
    setRows(buildRows(suggestedHolidays(province, year), savedHolidays));
    setError(null);
    setSaved(null);
  }

  function payload() {
    return {
      year,
      holidays: rows
        .filter((r) => r.observed)
        .map((r) => ({
          date: r.date,
          name: r.name.trim() || "Holiday",
          observance: r.observance,
          windows: r.observance === "custom_hours" ? r.windows : [],
        })),
    };
  }

  function validate(): string | null {
    for (const r of rows) {
      if (!r.observed) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return `"${r.name || "A holiday"}" needs a date.`;
      if (!r.date.startsWith(`${year}-`)) return `${r.name || r.date} is not in ${year}.`;
      if (r.observance !== "custom_hours") continue;
      if (r.windows.length === 0) return `${r.name}: choose Closed, or give at least one set of hours.`;
      for (const w of r.windows) {
        const opens = timeToMinutes(w.opens);
        const closes = timeToMinutes(w.closes);
        if (opens === null || closes === null) return `${r.name} has an incomplete time.`;
        if (closes <= opens) return `${r.name}: a window has to end after it starts.`;
      }
    }
    const dates = rows.filter((r) => r.observed).map((r) => r.date);
    const dup = dates.find((d, i) => dates.indexOf(d) !== i);
    if (dup) return `${dup} is listed twice.`;
    return null;
  }

  async function handleSave() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(null);

    const body = payload();
    const res = await fetch(`/api/departments/${departmentId}/holidays`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(json.error ?? "Could not save holidays.");
      setSaving(false);
      return;
    }

    // What was sent is now what is stored, so the section stops reading as
    // unsaved without a refetch.
    setSavedHolidays(body.holidays);

    const moved = json.sessionsFollowing ?? 0;
    setSaved(
      moved > 0
        ? `Saved ${json.saved} for ${json.year}. ${moved} session${moved === 1 ? "" : "s"} following these hours will honour them.`
        : `Saved ${json.saved} for ${json.year}.`
    );
    setSaving(false);
    router.refresh();
  }

  /** Writes this year's decisions to another department verbatim. The common
   *  case at a multi-department facility is that the building closes, not one
   *  pool — and re-ticking twelve boxes per department is how a good idea
   *  stops being used. */
  async function copyTo(targetId: string) {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setCopying(true);
    setError(null);
    setSaved(null);

    const res = await fetch(`/api/departments/${targetId}/holidays`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    const json = await res.json().catch(() => ({}));
    setCopying(false);

    if (!res.ok) {
      setError(json.error ?? "Could not copy to that department.");
      return;
    }
    const name = siblings.find((s) => s.id === targetId)?.name ?? "that department";
    setSaved(`Copied ${json.saved} ${year} holiday${json.saved === 1 ? "" : "s"} to ${name}.`);
  }

  const observed = rows.filter((r) => r.observed);
  const byObservance = {
    closed: observed.filter((r) => r.observance === "closed").length,
    custom_hours: observed.filter((r) => r.observance === "custom_hours").length,
    normal_hours: observed.filter((r) => r.observance === "normal_hours").length,
  };
  const unansweredStatutory = rows.filter((r) => r.kind === "statutory" && !r.observed).length;
  const visible = onlyObserved ? observed : rows;

  const fieldClass =
    "px-2 py-1.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <section className="bg-card rounded-xl border border-border">
      <header className="space-y-3 border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold text-foreground">Holidays</h2>
              <InfoTip label="About holidays">
                Dates that override the weekly operating hours. Tick the ones this department
                observes and say what happens — sessions set to run the whole time you are open
                will follow. Anything left unticked is an ordinary day.
              </InfoTip>
              {dirty && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  Unsaved
                </span>
              )}
            </div>
            {/* The year's answer in one line: what is decided, and what is
                still a suggestion nobody has looked at. */}
            <p className="mt-1 text-sm text-muted-foreground">
              {observed.length === 0
                ? `Nothing confirmed for ${year} yet.`
                : [
                    byObservance.closed > 0 ? `${byObservance.closed} closed` : null,
                    byObservance.custom_hours > 0 ? `${byObservance.custom_hours} reduced hours` : null,
                    byObservance.normal_hours > 0 ? `${byObservance.normal_hours} open as usual` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
              {rows.length - observed.length > 0 && (
                <span> · {rows.length - observed.length} suggested, not ticked</span>
              )}
            </p>
          </div>
          <select
            value={year}
            onChange={(e) => changeYear(Number(e.target.value))}
            disabled={loadingYear || saving}
            aria-label="Year"
            className={cn(fieldClass, "shrink-0 font-medium")}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {unansweredStatutory > 0 && (
            <button
              type="button"
              onClick={observeAllStatutory}
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Observe all {unansweredStatutory} statutory dates
            </button>
          )}
          {observed.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-muted-foreground hover:text-foreground"
            >
              Untick everything
            </button>
          )}
          {observed.length > 0 && rows.length > observed.length && (
            <button
              type="button"
              onClick={() => setOnlyObserved((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
            >
              {onlyObserved ? `Show all ${rows.length} dates` : `Show only the ${observed.length} observed`}
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Suggested from {province ? `${province}'s` : "the national"} statutory holidays — a
          starting point to confirm, not a legal list. Nothing is saved until you tick it.
        </p>
      </header>

      <div className={cn("p-4 sm:p-5", loadingYear && "opacity-50")}>
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {onlyObserved ? "Nothing ticked yet." : `No suggested dates for ${year}.`}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((row) => {
              // The index in `rows`, not in `visible` — every mutation
              // addresses the real list, which the filter above can shorten.
              const i = rows.indexOf(row);
              const prev = visible[visible.indexOf(row) - 1];
              const newMonth = !prev || monthLabel(prev.date) !== monthLabel(row.date);

              return (
                <div key={`${row.date}-${i}`} className="py-2.5">
                  {newMonth && !row.custom && (
                    <p className="pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {monthLabel(row.date)}
                    </p>
                  )}

                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={row.observed}
                      onChange={(e) => mutate(i, { observed: e.target.checked })}
                      aria-label={`Observe ${row.name || row.date}`}
                      className="mt-1 w-4 h-4 shrink-0 rounded border-border text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                    />

                    <div className="min-w-0 flex-1 space-y-2">
                      {/* Name, date and decision on one line, so a year reads
                          as a list of answers instead of a stack of radios. */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        {row.custom ? (
                          <>
                            <input
                              type="date"
                              value={row.date}
                              onChange={(e) => mutate(i, { date: e.target.value })}
                              aria-label="Holiday date"
                              className={fieldClass}
                            />
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => mutate(i, { name: e.target.value })}
                              placeholder="Name, e.g. Staff training day"
                              aria-label="Holiday name"
                              className={`${fieldClass} flex-1 min-w-[10rem]`}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setRows((prevRows) => prevRows.filter((_, j) => j !== i));
                                setSaved(null);
                              }}
                              aria-label={`Remove ${row.name || row.date}`}
                              className="p-1 text-muted-foreground hover:text-red-600 rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
                              {formatDate(row.date)}
                            </span>
                            <span
                              className={cn(
                                "text-sm font-medium",
                                row.observed ? "text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {row.name}
                            </span>
                            {row.kind === "common" && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                not statutory here
                              </span>
                            )}
                          </>
                        )}

                        {row.observed && (
                          <select
                            value={row.observance}
                            onChange={(e) => mutate(i, { observance: e.target.value as Observance })}
                            aria-label={`What happens on ${row.name || row.date}`}
                            className={cn(fieldClass, "ml-auto shrink-0")}
                          >
                            {(Object.keys(OBSERVANCE_LABELS) as Observance[]).map((value) => (
                              <option key={value} value={value}>
                                {OBSERVANCE_LABELS[value]}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {row.note && !row.observed && (
                        <p className="text-xs text-muted-foreground">{row.note}</p>
                      )}

                      {row.observed && row.observance === "custom_hours" && (
                        <div className="space-y-2">
                          {row.windows.map((w, wi) => (
                            <div key={wi} className="flex items-center gap-2">
                              <input
                                type="time"
                                value={w.opens}
                                aria-label={`${row.name} window ${wi + 1} opens`}
                                onChange={(e) =>
                                  mutate(i, {
                                    windows: row.windows.map((x, j) =>
                                      j === wi ? { ...x, opens: e.target.value } : x
                                    ),
                                  })
                                }
                                className={fieldClass}
                              />
                              <span className="text-sm text-muted-foreground">to</span>
                              <input
                                type="time"
                                value={w.closes}
                                aria-label={`${row.name} window ${wi + 1} closes`}
                                onChange={(e) =>
                                  mutate(i, {
                                    windows: row.windows.map((x, j) =>
                                      j === wi ? { ...x, closes: e.target.value } : x
                                    ),
                                  })
                                }
                                className={fieldClass}
                              />
                              {row.windows.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    mutate(i, { windows: row.windows.filter((_, j) => j !== wi) })
                                  }
                                  aria-label={`Remove ${row.name} window ${wi + 1}`}
                                  className="p-1 text-muted-foreground hover:text-red-600 rounded"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => mutate(i, { windows: [...row.windows, { ...DEFAULT_WINDOW }] })}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <Plus className="w-3 h-3" /> Add another window
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={addCustom}
          className="mt-4 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          <Plus className="w-3 h-3" /> Add a date of your own
        </button>
      </div>

      <footer className="space-y-3 border-t border-border p-4 sm:p-5">
        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {saved}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loadingYear || !dirty}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors sm:w-auto sm:px-5"
          >
            {saving
              ? "Saving…"
              : dirty
                ? `Save ${observed.length} holiday${observed.length === 1 ? "" : "s"} for ${year}`
                : "Saved"}
          </button>

          {dirty && !saving && (
            <button
              type="button"
              onClick={discard}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
              Discard changes
            </button>
          )}

          {siblings.length > 0 && (
            <select
              value=""
              disabled={copying || saving}
              onChange={(e) => e.target.value && copyTo(e.target.value)}
              aria-label="Copy these holidays to another department"
              className={cn(fieldClass, "sm:ml-auto")}
            >
              <option value="">{copying ? "Copying…" : "Copy to…"}</option>
              {siblings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </footer>
    </section>
  );
}

/** The comparable form of a set of rows: what would be sent to the server.
 *  Unticked rows and the fields that only matter to the screen are left out,
 *  so re-ordering or opening a row never reads as an edit. */
function snapshot(rows: HolidayRow[]): string {
  return JSON.stringify(
    rows
      .filter((r) => r.observed)
      .map((r) => ({
        date: r.date,
        name: r.name.trim() || "Holiday",
        observance: r.observance,
        windows: r.observance === "custom_hours" ? r.windows : [],
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  );
}
