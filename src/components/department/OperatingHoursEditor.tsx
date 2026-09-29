"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, RotateCcw } from "lucide-react";
import {
  DAY_NAMES,
  DAY_LABELS_SHORT,
  mergeWindows,
  summarizeWeek,
  timeToMinutes,
  minutesToTime,
  type OperatingWindow,
} from "@/lib/schedule/operating-hours";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { useSectionDirty } from "@/components/department/section-dirty";
import { cn } from "@/lib/utils/cn";

/** A window while it is being typed. Kept as strings, not minutes, because a
 *  half-typed <input type="time"> is legitimately unparseable and coercing it
 *  every keystroke would fight the person editing it. */
interface DraftWindow {
  opens: string;
  closes: string;
}

interface OperatingHoursEditorProps {
  departmentId: string;
  /** Indexed 0=Sunday..6=Saturday, matching the API and day_of_week (058). */
  initialDays: DraftWindow[][];
  /** How many active sessions currently follow these hours. Shown so staff
   *  know a save here republishes those sessions' times. */
  sessionsFollowing: number;
}

/** Monday-first display order. The 0=Sunday indexing is a machine detail
 *  (getUTCDay()); a staff member reading a week expects it to start on
 *  Monday, so only the render order changes — never the indices. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** What opening a previously-closed day seeds. A real default beats an empty
 *  pair of time inputs, which staff have to fill twice before the row means
 *  anything. */
const DEFAULT_WINDOW: DraftWindow = { opens: "06:00", closes: "21:00" };

export default function OperatingHoursEditor({
  departmentId,
  initialDays,
  sessionsFollowing,
}: OperatingHoursEditorProps) {
  const router = useRouter();
  const [days, setDays] = useState<DraftWindow[][]>(() => clone(initialDays));
  /** The week as the server last confirmed it — what Reset returns to, and
   *  what "unsaved changes" is measured against. */
  const [savedDays, setSavedDays] = useState<DraftWindow[][]>(() => clone(initialDays));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  /** What a day held when it was last closed, so toggling a day off and back
   *  on returns its hours instead of a default nobody typed. */
  const stashed = useRef<DraftWindow[][]>([[], [], [], [], [], [], []]);

  const dirty = JSON.stringify(days) !== JSON.stringify(savedDays);
  useSectionDirty("hours", dirty);

  function mutate(day: number, next: DraftWindow[]) {
    setDays((prev) => prev.map((d, i) => (i === day ? next : d)));
    setSaved(null);
  }

  function addWindow(day: number) {
    const existing = days[day];
    // A second window on a day starts after the last one ends, so the common
    // case (a midday closure) is one edit rather than four.
    const lastClose = existing.length > 0 ? timeToMinutes(existing[existing.length - 1].closes) : null;
    const seed: DraftWindow =
      lastClose !== null && lastClose < 22 * 60
        ? { opens: minutesToTime(lastClose + 60), closes: minutesToTime(Math.min(lastClose + 300, 23 * 60 + 59)) }
        : DEFAULT_WINDOW;
    mutate(day, [...existing, seed]);
  }

  function removeWindow(day: number, index: number) {
    mutate(day, days[day].filter((_, i) => i !== index));
  }

  function setField(day: number, index: number, field: keyof DraftWindow, value: string) {
    mutate(
      day,
      days[day].map((w, i) => (i === index ? { ...w, [field]: value } : w))
    );
  }

  /** Open/closed as one switch per day. Closing used to mean deleting every
   *  window with the little x, which reads as "undo a mistake" rather than
   *  "we are shut on Sundays" — and made reopening a retype. */
  function setOpen(day: number, open: boolean) {
    if (!open) {
      stashed.current[day] = days[day].map((w) => ({ ...w }));
      mutate(day, []);
      return;
    }
    const remembered = stashed.current[day];
    mutate(day, remembered.length > 0 ? remembered.map((w) => ({ ...w })) : [{ ...DEFAULT_WINDOW }]);
  }

  /** Copies Monday onto the rest of the week. Weekdays is the single most
   *  common shape by a wide margin, and entering it by hand is twenty time
   *  pickers; "every day" is the next one. */
  function copyMonday(to: "weekdays" | "week") {
    setDays((prev) =>
      prev.map((d, i) => {
        if (i === 1) return d;
        const inScope = to === "week" || (i >= 2 && i <= 5);
        return inScope ? prev[1].map((w) => ({ ...w })) : d;
      })
    );
    setSaved(null);
  }

  function reset() {
    setDays(clone(savedDays));
    setError(null);
    setSaved(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(null);

    // Validated here as well as on the server, because the server's answer is
    // a single message for the whole week and this can point at the day.
    for (const day of DISPLAY_ORDER) {
      for (const w of days[day]) {
        const opens = timeToMinutes(w.opens);
        const closes = timeToMinutes(w.closes);
        if (opens === null || closes === null) {
          setError(`${DAY_NAMES[day]} has an incomplete time.`);
          setSaving(false);
          return;
        }
        if (closes <= opens) {
          setError(`${DAY_NAMES[day]}: a window has to end after it starts.`);
          setSaving(false);
          return;
        }
      }
    }

    const res = await fetch(`/api/departments/${departmentId}/hours`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(json.error ?? "Could not save operating hours.");
      setSaving(false);
      return;
    }

    // Reflect the merge the server just performed, so the grid on screen is
    // the grid that was stored — otherwise staff who entered 6-12 and 11-9
    // would keep seeing two windows that the schedule treats as one. Both the
    // draft and the saved snapshot take it, or the merge itself would read as
    // an unsaved change.
    const merged = days.map((d) => mergeDraft(d).map(toDraft));
    setDays(merged);
    setSavedDays(clone(merged));

    const moved = json.sessionsFollowing ?? 0;
    setSaved(
      moved > 0
        ? `Saved. ${moved} session${moved === 1 ? "" : "s"} following these hours ${moved === 1 ? "has" : "have"} moved to match.`
        : "Saved."
    );
    setSaving(false);
    router.refresh();
  }

  const week = days.map((d) => mergeDraft(d));
  const liveSummary = summarizeWeek(week);
  const openDays = week.filter((d) => d.length > 0).length;

  return (
    <section className="rounded-card border border-border bg-card shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5 sm:p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-heading text-foreground">Operating hours</h2>
            <InfoTip label="About operating hours">
              When this department is open. A session can be set to run the whole time you are
              open instead of carrying its own times — change the hours here and those sessions
              move with them. A day with no hours is closed, and sessions following these hours
              skip it entirely.
            </InfoTip>
          </div>
          {/* The week in one line, from the draft rather than the saved rows,
              so an edit can be read back before it is committed. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {openDays === 0 ? "Closed every day — no hours set yet." : liveSummary}
          </p>
        </div>
        {dirty && (
          <Badge variant="warning" className="shrink-0">
            Unsaved
          </Badge>
        )}
      </header>

      <div className="p-5 sm:p-6">
        {days[1].length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">Quick fill:</span>
            <Button
              type="button"
              variant="link"
              onClick={() => copyMonday("weekdays")}
              className="text-xs"
            >
              Copy Monday to Tue–Fri
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => copyMonday("week")}
              className="text-xs"
            >
              Copy Monday to every day
            </Button>
          </div>
        )}

        <div className="divide-y divide-border">
          {DISPLAY_ORDER.map((day) => {
            const windows = days[day];
            const open = windows.length > 0;
            const total = totalLabel(windows);

            return (
              <div key={day} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex items-center gap-3 sm:w-44 sm:shrink-0 sm:pt-1">
                  <OpenSwitch
                    day={day}
                    open={open}
                    onChange={(next) => setOpen(day, next)}
                  />
                  <span
                    className={cn(
                      "text-sm font-medium",
                      open ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <span className="sm:hidden">{DAY_NAMES[day]}</span>
                    <span className="hidden sm:inline">{DAY_LABELS_SHORT[day]}</span>
                  </span>
                  {/* On a phone the day's total sits beside its name, where it
                      can be scanned down the column. */}
                  <span className="ml-auto text-xs text-muted-foreground sm:hidden">
                    {open ? total : "Closed"}
                  </span>
                </div>

                <div className="flex-1 space-y-2">
                  {!open ? (
                    <span className="hidden text-sm text-muted-foreground sm:inline">Closed</span>
                  ) : (
                    <>
                      {windows.map((w, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            type="time"
                            aria-label={`${DAY_NAMES[day]} window ${i + 1} opens`}
                            value={w.opens}
                            onChange={(e) => setField(day, i, "opens", e.target.value)}
                            className="h-8 w-auto px-2 py-1"
                          />
                          <span className="text-sm text-muted-foreground">to</span>
                          <Input
                            type="time"
                            aria-label={`${DAY_NAMES[day]} window ${i + 1} closes`}
                            value={w.closes}
                            onChange={(e) => setField(day, i, "closes", e.target.value)}
                            className="h-8 w-auto px-2 py-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeWindow(day, i)}
                            aria-label={`Remove ${DAY_NAMES[day]} window ${i + 1}`}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => addWindow(day)}
                          className="gap-1 text-xs"
                        >
                          <Plus className="w-3 h-3" /> Add another window
                        </Button>
                        <span className="hidden text-xs text-muted-foreground sm:inline">{total}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="space-y-3 border-t border-border p-5 sm:p-6">
        {sessionsFollowing > 0 && (
          <p className="text-xs text-muted-foreground">
            {sessionsFollowing} active session{sessionsFollowing === 1 ? "" : "s"} follow
            {sessionsFollowing === 1 ? "s" : ""} these hours and will move when you save.
          </p>
        )}

        {error && (
          <Banner variant="error">
            {error}
          </Banner>
        )}
        {saved && (
          <p role="status" className="text-sm text-success">
            {saved}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="w-full sm:w-auto"
          >
            {saving ? "Saving…" : dirty ? "Save operating hours" : "Saved"}
          </Button>
          {dirty && !saving && (
            <Button
              type="button"
              variant="ghost"
              onClick={reset}
            >
              <RotateCcw className="size-3.5" />
              Discard changes
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}

interface OpenSwitchProps {
  day: number;
  open: boolean;
  onChange: (open: boolean) => void;
}

function OpenSwitch({ day, open, onChange }: OpenSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={open}
      aria-label={`${DAY_NAMES[day]} open`}
      onClick={() => onChange(!open)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        open ? "bg-primary" : "bg-input"
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full shadow-card transition-transform",
          open ? "translate-x-4 bg-primary-foreground" : "translate-x-0.5 bg-card"
        )}
      />
    </button>
  );
}

function clone(days: DraftWindow[][]): DraftWindow[][] {
  return days.map((d) => d.map((w) => ({ ...w })));
}

/** The parseable, merged view of one day's draft — what the server will store
 *  if it is saved as-is. Unparseable half-typed windows drop out rather than
 *  poisoning the summary. */
function mergeDraft(day: DraftWindow[]): OperatingWindow[] {
  const parsed: OperatingWindow[] = [];
  for (const w of day) {
    const opens = timeToMinutes(w.opens);
    const closes = timeToMinutes(w.closes);
    if (opens !== null && closes !== null && closes > opens) parsed.push({ opens, closes });
  }
  return mergeWindows(parsed);
}

function toDraft(w: OperatingWindow): DraftWindow {
  return { opens: minutesToTime(w.opens), closes: minutesToTime(w.closes) };
}

/** "15h" / "6h 30m" — how long the department is actually open that day, gaps
 *  excluded. The fastest way to catch a PM/AM slip in a grid of time inputs. */
function totalLabel(day: DraftWindow[]): string {
  const minutes = mergeDraft(day).reduce((sum, w) => sum + (w.closes - w.opens), 0);
  if (minutes === 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : h === 0 ? `${m}m` : `${h}h ${m}m`;
}
