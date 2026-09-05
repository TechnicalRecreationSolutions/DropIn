"use client";

import { useState } from "react";
import { CalendarDays, Search, SlidersHorizontal, X } from "lucide-react";
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
} from "@/lib/schedule/sessionFilters";
import type { ExpandedSession } from "@/types/schedule.types";

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
}

/**
 * The visitor's "when can I actually come" controls.
 *
 * Which controls appear is the org's choice (`widget_configs.enabled_filters`,
 * migration 044), and a control also hides itself when the loaded week offers
 * fewer than two values for it — a "Space" dropdown listing one pool is noise,
 * and orgs that enable everything shouldn't be punished for it.
 *
 * Deliberately chips-in-a-panel rather than a row of dropdowns: it is one tap
 * per choice on a phone, it needs no portals (which are exactly what breaks
 * inside a themed iframe), and the whole filter state stays visible as
 * removable chips even while the panel is shut.
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
}: ScheduleFilterBarProps) {
  const [open, setOpen] = useState(false);
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
  const hasPanel = showActivity || showDay || showTime || showSpace || showAge || showWeek;

  if (!showSearch && !hasPanel) return null;

  const count = activeFilterCount(state);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  const border = dark ? "border-gray-800" : "border-gray-200";
  const muted = dark ? "text-gray-400" : "text-gray-500";
  const chipIdle = dark
    ? "bg-gray-800 text-gray-200 hover:bg-gray-700 border-gray-700"
    : "bg-gray-100 text-gray-700 hover:bg-gray-200 border-transparent";

  const chipClass = (active: boolean) =>
    cn(
      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap",
      active ? "text-white border-transparent" : chipIdle
    );
  const chipStyle = (active: boolean) =>
    active ? { backgroundColor: "var(--org-primary, #0066CC)" } : undefined;

  return (
    <div className={cn("border-b", border, dark ? "bg-gray-900" : "bg-white")}>
      <div className="px-3 py-2.5 flex items-center gap-2 flex-wrap">
        {showSearch && (
          <div className="relative flex-1 min-w-40">
            <Search
              className={cn("absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5", muted)}
              aria-hidden="true"
            />
            <input
              type="search"
              value={state.search}
              onChange={(e) => onChange({ ...state, search: e.target.value })}
              placeholder="Search activities, e.g. Water Walking"
              aria-label="Search the schedule"
              className={cn(
                "w-full pl-8 pr-3 py-1.5 rounded-full text-xs sm:text-sm border outline-none focus:ring-2 focus:ring-blue-500/40",
                dark
                  ? "bg-gray-800 border-gray-700 text-gray-100 placeholder:text-gray-500"
                  : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400"
              )}
            />
          </div>
        )}

        {hasPanel && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              dark
                ? "border-gray-700 text-gray-200 hover:bg-gray-800"
                : "border-gray-200 text-gray-700 hover:bg-gray-50"
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {count > 0 && (
              <span
                className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold text-white"
                style={{ backgroundColor: "var(--org-primary, #0066CC)" }}
              >
                {count}
              </span>
            )}
          </button>
        )}

        {count > 0 && (
          <>
            <span className={cn("text-xs", muted)}>
              {matchCount} {matchCount === 1 ? "session" : "sessions"}
            </span>
            <button
              type="button"
              onClick={() =>
                onChange({ search: "", activities: [], days: [], times: [], spaces: [], ages: [] })
              }
              className={cn(
                "text-xs font-medium underline underline-offset-2",
                dark ? "text-gray-300 hover:text-white" : "text-gray-600 hover:text-gray-900"
              )}
            >
              Clear all
            </button>
          </>
        )}
      </div>

      {/* Active choices stay visible with the panel shut, so nobody is left
          wondering why the schedule looks half empty. */}
      {count > 0 && !open && (
        <div className="px-3 pb-2.5 flex items-center gap-1.5 flex-wrap">
          {state.activities.map((value) => (
            <ActiveChip
              key={`a-${value}`}
              label={value}
              dark={dark}
              onRemove={() => onChange({ ...state, activities: toggle(state.activities, value) })}
            />
          ))}
          {state.days.map((value) => (
            <ActiveChip
              key={`d-${value}`}
              label={DAY_LABELS[value]}
              dark={dark}
              onRemove={() => onChange({ ...state, days: toggle(state.days, value) })}
            />
          ))}
          {state.times.map((value) => (
            <ActiveChip
              key={`t-${value}`}
              label={TIME_BANDS.find((b) => b.value === value)?.label ?? value}
              dark={dark}
              onRemove={() => onChange({ ...state, times: toggle(state.times, value) })}
            />
          ))}
          {state.spaces.map((value) => (
            <ActiveChip
              key={`s-${value}`}
              label={value}
              dark={dark}
              onRemove={() => onChange({ ...state, spaces: toggle(state.spaces, value) })}
            />
          ))}
          {state.ages.map((value) => (
            <ActiveChip
              key={`g-${value}`}
              label={value}
              dark={dark}
              onRemove={() => onChange({ ...state, ages: toggle(state.ages, value) })}
            />
          ))}
        </div>
      )}

      {open && hasPanel && (
        <div className={cn("px-3 pb-3 space-y-3 border-t", border)}>
          {showActivity && (
            <FilterGroup label="Activity" dark={dark}>
              {options.activities.map((activity) => {
                const active = state.activities.includes(activity);
                return (
                  <button
                    key={activity}
                    type="button"
                    onClick={() => onChange({ ...state, activities: toggle(state.activities, activity) })}
                    aria-pressed={active}
                    className={chipClass(active)}
                    style={chipStyle(active)}
                  >
                    {activity}
                  </button>
                );
              })}
            </FilterGroup>
          )}

          {showDay && (
            <FilterGroup label="Day" dark={dark}>
              {options.days.map((day) => {
                const active = state.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => onChange({ ...state, days: toggle(state.days, day) })}
                    aria-pressed={active}
                    aria-label={DAY_LABELS[day]}
                    className={chipClass(active)}
                    style={chipStyle(active)}
                  >
                    {DAY_LABELS[day]}
                  </button>
                );
              })}
            </FilterGroup>
          )}

          {showTime && (
            <FilterGroup label="Time of day" dark={dark}>
              {options.times.map((band) => {
                const active = state.times.includes(band);
                const meta = TIME_BANDS.find((b) => b.value === band);
                return (
                  <button
                    key={band}
                    type="button"
                    onClick={() => onChange({ ...state, times: toggle(state.times, band) as TimeBand[] })}
                    aria-pressed={active}
                    title={meta?.detail}
                    className={chipClass(active)}
                    style={chipStyle(active)}
                  >
                    {meta?.label ?? band}
                  </button>
                );
              })}
            </FilterGroup>
          )}

          {showSpace && (
            <FilterGroup label="Where" dark={dark}>
              {options.spaces.map((space) => {
                const active = state.spaces.includes(space);
                return (
                  <button
                    key={space}
                    type="button"
                    onClick={() => onChange({ ...state, spaces: toggle(state.spaces, space) })}
                    aria-pressed={active}
                    className={chipClass(active)}
                    style={chipStyle(active)}
                  >
                    {space}
                  </button>
                );
              })}
            </FilterGroup>
          )}

          {showAge && (
            <FilterGroup label="Who it's for" dark={dark}>
              {options.ages.map((age) => {
                const active = state.ages.includes(age);
                return (
                  <button
                    key={age}
                    type="button"
                    onClick={() => onChange({ ...state, ages: toggle(state.ages, age) })}
                    aria-pressed={active}
                    className={chipClass(active)}
                    style={chipStyle(active)}
                  >
                    {age}
                  </button>
                );
              })}
            </FilterGroup>
          )}

          {showWeek && (
            <FilterGroup label="Week" dark={dark}>
              <label
                className={cn(
                  "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border",
                  dark ? "border-gray-700 text-gray-200" : "border-gray-200 text-gray-700"
                )}
              >
                <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="sr-only">Jump to the week containing this date</span>
                <input
                  type="date"
                  value={localDateString(weekStart)}
                  onChange={(e) => {
                    if (e.target.value) onWeekChange(parseDate(e.target.value));
                  }}
                  aria-label="Jump to the week containing this date"
                  className={cn("bg-transparent outline-none", dark ? "text-gray-100" : "text-gray-900")}
                />
              </label>
            </FilterGroup>
          )}
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  dark,
  children,
}: {
  label: string;
  dark: boolean;
  children: React.ReactNode;
}) {
  return (
    // Labelled group per dimension: it gives a screen reader "Activity, group"
    // instead of a bare run of buttons, and it makes each chip addressable by
    // which filter it belongs to rather than by its text alone — an activity
    // chip and the session it filters for are, necessarily, the same words.
    <div role="group" aria-label={label} className="pt-3">
      <p
        className={cn(
          "text-[11px] font-semibold uppercase tracking-wide mb-1.5",
          dark ? "text-gray-400" : "text-gray-500"
        )}
      >
        {label}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
    </div>
  );
}

function ActiveChip({
  label,
  dark,
  onRemove,
}: {
  label: string;
  dark: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-[11px] font-medium",
        dark ? "bg-gray-800 text-gray-100" : "bg-gray-100 text-gray-800"
      )}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className={cn(
          "rounded-full p-0.5 transition-colors",
          dark ? "hover:bg-gray-700" : "hover:bg-gray-200"
        )}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
