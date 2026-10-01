"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { localDateString, parseDate } from "@/lib/utils/dates";
import {
  DAY_LABELS,
  TIME_BANDS,
  activeFilterCount,
  deriveFilterOptions,
  type SessionFilterKey,
  type SessionFilterState,
  type TimeBand,
  EMPTY_FILTER_STATE,
} from "@/lib/schedule/sessionFilters";
import type { ExpandedSession } from "@/types/schedule.types";
import TickBoxList, { summarizeTicks, useDismissable } from "./TickBoxList";

interface ScheduleFilterBarProps {
  /** The week's sessions *before* filtering — the option lists come from these. */
  sessions: ExpandedSession[];
  /** How many survive the current filters, for the result count. */
  matchCount: number;
  enabled: SessionFilterKey[];
  state: SessionFilterState;
  onChange: (next: SessionFilterState) => void;
  /** The week in view, for the "jump to a week" control. */
  weekStart: Date;
  onWeekChange: (date: Date) => void;
  /**
   * Renders on the widget's dark theme. Every colour here is written out
   * explicitly rather than taken from a token: this renders inside an embed
   * iframe on someone else's site, where the dashboard's `.dark` class does
   * not exist and every neutral token would resolve to its light value.
   */
  dark?: boolean;
  /**
   * Whether the controls start folded away behind the "Filters" toggle —
   * `widget_configs.filters_collapsed` (migration 066). Visitors can open or
   * close the section either way; this only picks how it starts.
   */
  defaultCollapsed?: boolean;
  /** Controlled open state, for a caller that decides it after mount (the
   *  landing hero folds it on a phone). Omit both to let the bar own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Drawn on the toggle row after the label — the landing hero's handwritten note. */
  toggleNote?: React.ReactNode;
}

/**
 * The visitor's "when can I actually come" controls.
 *
 * Which controls appear is the org's choice (`widget_configs.enabled_filters`,
 * migration 044), and a control also hides itself when the loaded week offers
 * fewer than two values for it — a "Where" dropdown listing one pool is noise,
 * and orgs that enable everything shouldn't be punished for it.
 *
 * A row of labelled dropdowns. Each opens a list of checkboxes, so a visitor
 * can still ask for "Tuesday or Thursday, in the morning" (OR within a filter,
 * AND across them — see `filterSessions`). The list is drawn in place under
 * its button rather than in a portal, which is what breaks inside a themed
 * iframe.
 *
 * The whole section folds behind a "Filters" toggle, which carries the active
 * count so a folded section never hides that something is filtering. The
 * result count and "Clear filters" sit outside the fold for the same reason.
 * Whether it starts folded is the org's choice (`defaultCollapsed`).
 */
export default function ScheduleFilterBar({
  sessions,
  matchCount,
  enabled,
  state,
  onChange,
  weekStart,
  onWeekChange,
  dark = false,
  defaultCollapsed = false,
  open: openProp,
  onOpenChange,
  toggleNote,
}: ScheduleFilterBarProps) {
  const idPrefix = useId();
  const [openState, setOpenState] = useState(!defaultCollapsed);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const options = deriveFilterOptions(sessions);

  const has = (key: SessionFilterKey) => enabled.includes(key);
  // A one-option filter can only ever be a no-op or an empty schedule.
  const showActivity = has("activity") && options.activities.length > 1;
  const showDay = has("day") && options.days.length > 1;
  const showTime = has("time") && options.times.length > 1;
  const showSpace = has("space") && options.spaces.length > 1;
  const showAge = has("age") && options.ages.length > 1;
  const showWeek = has("week");
  const showSearch = has("search") && sessions.length > 0;

  if (!showSearch && !showActivity && !showDay && !showTime && !showSpace && !showAge && !showWeek) {
    return null;
  }

  const count = activeFilterCount(state);
  const theme = themeClasses(dark);

  return (
    <div className={cn("border-b px-4 py-3", dark ? "border-white/10 bg-gray-900" : "border-gray-200 bg-white")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`${idPrefix}-controls`}
        className={cn(
          "-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 py-1 text-left text-[13px] font-medium outline-none",
          "focus-visible:ring-2",
          dark ? "text-gray-100" : "text-[#111113]"
        )}
        style={RING_STYLE}
      >
        <SlidersHorizontal aria-hidden className={cn("size-4 shrink-0", theme.icon)} />
        Filters
        {count > 0 && (
          <span
            className="inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-5 font-semibold text-white"
            style={{ backgroundColor: "var(--org-primary, #0066CC)" }}
          >
            {count}
            <span className="sr-only"> active</span>
          </span>
        )}
        {toggleNote}
        <span className={cn("ml-auto text-xs font-normal", theme.muted)}>{open ? "Hide" : "Show"}</span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform", open && "rotate-180", theme.icon)} />
      </button>

      <div
        id={`${idPrefix}-controls`}
        className={cn("mt-3 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", open ? "grid" : "hidden")}
      >
        {showSearch && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-search`} className={theme.label}>
              Search
            </label>
            <span className="relative block">
              <Search aria-hidden className={cn("pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2", theme.icon)} />
              <input
                id={`${idPrefix}-search`}
                type="search"
                value={state.search}
                onChange={(e) => onChange({ ...state, search: e.target.value })}
                placeholder="e.g. Water Walking"
                className={cn(theme.field, "pl-9 pr-3", dark ? "placeholder:text-gray-500" : "placeholder:text-[#8a8a90]")}
                style={RING_STYLE}
              />
            </span>
          </div>
        )}

        {showActivity && (
          <CheckboxDropdown
            id={`${idPrefix}-activity`}
            label="Activity"
            allLabel="All activities"
            items={options.activities.map((a) => ({ value: a, label: a }))}
            selected={state.activities}
            onChange={(activities) => onChange({ ...state, activities })}
            dark={dark}
          />
        )}

        {showDay && (
          <CheckboxDropdown
            id={`${idPrefix}-day`}
            label="Day"
            allLabel="Any day"
            // All seven days, always. Listing only the days this week has sessions
            // on read as "Saturday is missing" whenever a week had none — the
            // empty ones stay pickable but say so up front.
            items={DAY_LABELS.map((label, d) => ({
              value: String(d),
              label,
              detail: options.days.includes(d) ? undefined : "No sessions this week",
            }))}
            selected={state.days.map(String)}
            onChange={(days) => onChange({ ...state, days: days.map(Number).sort((a, b) => a - b) })}
            dark={dark}
          />
        )}

        {showTime && (
          <CheckboxDropdown
            id={`${idPrefix}-time`}
            label="Time of day"
            allLabel="Any time"
            items={options.times.map((band) => {
              const meta = TIME_BANDS.find((b) => b.value === band);
              return { value: band, label: meta?.label ?? band, detail: meta?.detail };
            })}
            selected={state.times}
            onChange={(times) => onChange({ ...state, times: times as TimeBand[] })}
            dark={dark}
          />
        )}

        {showSpace && (
          <CheckboxDropdown
            id={`${idPrefix}-space`}
            label="Where"
            allLabel="Everywhere"
            items={options.spaces.map((sp) => ({ value: sp, label: sp }))}
            selected={state.spaces}
            onChange={(spaces) => onChange({ ...state, spaces })}
            dark={dark}
          />
        )}

        {showAge && (
          <CheckboxDropdown
            id={`${idPrefix}-age`}
            label="Who it’s for"
            allLabel="Everyone"
            items={options.ages.map((a) => ({ value: a, label: a }))}
            selected={state.ages}
            onChange={(ages) => onChange({ ...state, ages })}
            dark={dark}
          />
        )}

        {showWeek && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-week`} className={theme.label}>
              Week of
            </label>
            <input
              id={`${idPrefix}-week`}
              type="date"
              value={localDateString(weekStart)}
              onChange={(e) => {
                if (e.target.value) onWeekChange(parseDate(e.target.value));
              }}
              title="Jumps to the week containing this date"
              className={cn(theme.field, "px-3", dark && "[color-scheme:dark]")}
              style={RING_STYLE}
            />
          </div>
        )}
      </div>

      {/* The result count, only while something is filtering. Announced, so
          a screen reader hears the schedule change without hunting for it. */}
      <p aria-live="polite" className={cn("text-xs", count > 0 ? "mt-3" : "sr-only", theme.muted)}>
        {count > 0 && (
          <>
            Showing {matchCount} {matchCount === 1 ? "session" : "sessions"} ·{" "}
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTER_STATE)}
              className={cn("font-medium underline underline-offset-2", dark ? "text-white" : "text-[#111113]")}
            >
              Clear filters
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/** The focus ring and ticks take the centre's colour. */
const RING_STYLE = { "--tw-ring-color": "var(--org-primary, #0066CC)" } as React.CSSProperties;

/**
 * Explicit colours, not tokens — see the `dark` prop. A field's border is what
 * shows it is a control, so it holds 3:1 against its ground in both themes.
 */
function themeClasses(dark: boolean) {
  return {
    label: cn("text-xs font-medium", dark ? "text-gray-300" : "text-[#5d5d63]"),
    muted: dark ? "text-gray-300" : "text-[#5d5d63]",
    icon: dark ? "text-gray-400" : "text-[#5d5d63]",
    field: cn(
      "h-10 w-full rounded-[10px] border text-sm outline-none transition-colors",
      "focus-visible:ring-2 focus-visible:ring-offset-1",
      dark
        ? "bg-gray-800 border-gray-500 text-gray-100 focus-visible:ring-offset-gray-900"
        : "bg-white border-[#86868d] text-[#111113] focus-visible:ring-offset-white"
    ),
    panel: dark ? "bg-gray-800 border-gray-600 text-gray-100" : "bg-white border-[#e4e4e7] text-[#111113]",
    row: dark ? "hover:bg-white/5" : "hover:bg-[#f4f4f5]",
  };
}

/**
 * One filter: a field-shaped button that opens a list of checkboxes beneath
 * it. Real checkboxes inside real labels, so each row is keyboard- and
 * screen-reader-operable with no extra roles. Escape or a click outside closes
 * it; Escape hands focus back to the button.
 */
function CheckboxDropdown({
  id,
  label,
  allLabel,
  items,
  selected,
  onChange,
  dark,
}: {
  id: string;
  label: string;
  allLabel: string;
  items: { value: string; label: string; detail?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  dark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const theme = themeClasses(dark);

  useDismissable(open, () => setOpen(false), rootRef, buttonRef);

  const panelId = `${id}-options`;

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-col gap-1.5">
      <span id={`${id}-label`} className={theme.label}>
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-labelledby={`${id}-label ${id}-value`}
        className={cn(theme.field, "flex items-center justify-between gap-2 pl-3 pr-2.5 text-left")}
        style={RING_STYLE}
      >
        <span id={`${id}-value`} className={cn("truncate", selected.length > 0 && "font-semibold")}>
          {summarizeTicks(items, selected, allLabel)}
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180", theme.icon)}
        />
      </button>

      {open && (
        <TickBoxList id={panelId} label={label} items={items} selected={selected} onChange={onChange} dark={dark} />
      )}
    </div>
  );
}
