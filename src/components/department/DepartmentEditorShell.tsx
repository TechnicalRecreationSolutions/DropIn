"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { CalendarDays, Clock, Eye, EyeOff, Pencil, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  SectionDirtyProvider,
  type DepartmentSection,
} from "@/components/department/section-dirty";

interface DepartmentEditorShellProps {
  facilityName: string;
  /** Monday-first one-liner from summarizeWeek(), or its empty-state string. */
  weekSummary: string;
  hasHours: boolean;
  holidaysObserved: number;
  holidayYear: number;
  sessionsFollowing: number;
  isPublished: boolean;
  scheduleHref: string;
  details: ReactNode;
  hours: ReactNode;
  holidays: ReactNode;
}

const SECTIONS: { key: DepartmentSection; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "hours", label: "Operating hours" },
  { key: "holidays", label: "Holidays" },
];

/** Fired by this component when it replaces the hash itself — replaceState is
 *  silent, so nothing else would tell the subscription the tab changed. */
const HASH_EVENT = "dropin:section-hash";

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener(HASH_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(HASH_EVENT, onChange);
  };
}

function readHash(): string {
  return window.location.hash.replace("#", "");
}

/**
 * The department edit page's frame: what this department currently says, then
 * one section at a time.
 *
 * This page used to be three full-height cards stacked in one column — a name
 * field, seven days of time inputs, and a dozen holidays each with three
 * radios — so answering "when is Aquatics open?" meant scrolling past every
 * control that could change it. The summary answers that without scrolling,
 * and each tile is the way into the section that owns it.
 *
 * Every section stays mounted (`hidden`, not unmounted), so switching tabs
 * never discards half-finished edits — which matters more here than elsewhere
 * because each section saves separately.
 */
export default function DepartmentEditorShell({
  facilityName,
  weekSummary,
  hasHours,
  holidaysObserved,
  holidayYear,
  sessionsFollowing,
  isPublished,
  scheduleHref,
  details,
  hours,
  holidays,
}: DepartmentEditorShellProps) {
  const [dirty, setDirty] = useState<Record<DepartmentSection, boolean>>({
    details: false,
    hours: false,
    holidays: false,
  });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const report = useCallback((section: DepartmentSection, value: boolean) => {
    setDirty((prev) => (prev[section] === value ? prev : { ...prev, [section]: value }));
  }, []);

  // Which section is open lives in the URL hash rather than in state, so a
  // reload, a deep link and the Back button all land where the person was.
  // Subscribed to rather than read once: the server has no location, and
  // seeding state from one during render would mismatch the hydrated markup.
  const hash = useSyncExternalStore(subscribeToHash, readHash, () => "");
  const active: DepartmentSection = SECTIONS.some((s) => s.key === hash)
    ? (hash as DepartmentSection)
    : "details";

  const anyDirty = dirty.details || dirty.hours || dirty.holidays;

  // Three separate saves means the browser is the last line of defence.
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  function select(section: DepartmentSection) {
    // replaceState, not the router: this is which tab is open, not a new place
    // to go back to, and pushing it would make Back mean "the previous tab".
    // It fires no event of its own, hence the explicit one.
    window.history.replaceState(null, "", `#${section}`);
    window.dispatchEvent(new Event(HASH_EVENT));
  }

  function onTabKeyDown(e: React.KeyboardEvent, index: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + SECTIONS.length) % SECTIONS.length;
    select(SECTIONS[next].key);
    tabRefs.current[next]?.focus();
  }

  const dirtyElsewhere = SECTIONS.filter((s) => dirty[s.key] && s.key !== active).map(
    (s) => s.label
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          icon={isPublished ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          label="Status"
          value={isPublished ? "Published" : "Draft"}
          detail={isPublished ? `Public on ${facilityName}'s pages` : "Not shown publicly"}
          tone={isPublished ? "positive" : "neutral"}
          onClick={() => select("details")}
        />
        <SummaryTile
          icon={<Clock className="size-4" />}
          label="Weekly hours"
          value={hasHours ? weekSummary : "Not set"}
          detail={
            !hasHours
              ? "Sessions cannot run the whole time you are open until these are set"
              : sessionsFollowing > 0
                ? `${sessionsFollowing} session${sessionsFollowing === 1 ? "" : "s"} follow${sessionsFollowing === 1 ? "s" : ""} them`
                : "No sessions follow them yet"
          }
          tone={hasHours ? "neutral" : "warning"}
          onClick={() => select("hours")}
        />
        <SummaryTile
          icon={<CalendarDays className="size-4" />}
          label={`Holidays ${holidayYear}`}
          value={holidaysObserved === 0 ? "None confirmed" : `${holidaysObserved} observed`}
          detail={
            holidaysObserved === 0
              ? "Suggested dates are waiting to be confirmed"
              : "These dates override the weekly hours"
          }
          tone={holidaysObserved === 0 ? "warning" : "neutral"}
          onClick={() => select("holidays")}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Department settings"
          className="inline-flex w-full gap-1 rounded-xl border border-border bg-muted/60 p-1 sm:w-auto"
        >
          {SECTIONS.map((section, i) => (
            <button
              key={section.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${section.key}`}
              aria-selected={active === section.key}
              aria-controls={`panel-${section.key}`}
              tabIndex={active === section.key ? 0 : -1}
              onClick={() => select(section.key)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={cn(
                "flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:flex-none sm:px-4",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                active === section.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {section.label}
              {dirty[section.key] && (
                <span
                  aria-label="unsaved changes"
                  className="ml-1.5 inline-block size-1.5 rounded-full bg-amber-500 align-middle"
                />
              )}
            </button>
          ))}
        </div>

        <Link
          href={scheduleHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          <ArrowUpRight className="size-4" />
          Open in schedule
        </Link>
      </div>

      {dirtyElsewhere.length > 0 && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <Pencil className="size-3.5 shrink-0" />
          Unsaved changes in {dirtyElsewhere.join(" and ")} — still there, on that tab.
        </p>
      )}

      <SectionDirtyProvider report={report}>
        {SECTIONS.map((section) => (
          <div
            key={section.key}
            role="tabpanel"
            id={`panel-${section.key}`}
            aria-labelledby={`tab-${section.key}`}
            hidden={active !== section.key}
          >
            {section.key === "details" ? details : section.key === "hours" ? hours : holidays}
          </div>
        ))}
      </SectionDirtyProvider>
    </div>
  );
}

interface SummaryTileProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "positive" | "neutral" | "warning";
  onClick: () => void;
}

/** One at-a-glance fact, and the way into the section that can change it. */
function SummaryTile({ icon, label, value, detail, tone, onClick }: SummaryTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-summary-tile={label}
      className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-blue-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide",
          tone === "positive"
            ? "text-green-700 dark:text-green-400"
            : tone === "warning"
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground"
        )}
      >
        {icon}
        {label}
      </span>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-foreground">{value}</p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{detail}</p>
    </button>
  );
}
