"use client";

import { useState, useEffect } from "react";
import { buildRRuleString, isOneTimeRRule, type RRuleFrequency } from "@/lib/rrule/validate";
import { formatRRule } from "@/lib/rrule/format";

const DAYS = [
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
];

interface RRuleBuilderProps {
  /** Current RRULE string value */
  value: string;
  /** Start time of the session (HH:MM) */
  startTime: string;
  /** End time of the session (HH:MM) */
  endTime: string;
  /** Recurrence start date (YYYY-MM-DD) */
  validFrom: string;
  /** Recurrence end date (YYYY-MM-DD) */
  validUntil: string;
  onRRuleChange: (rrule: string) => void;
  onStartTimeChange: (time: string) => void;
  onEndTimeChange: (time: string) => void;
  onValidFromChange: (date: string) => void;
  onValidUntilChange: (date: string) => void;
}

/**
 * Visual recurrence rule builder for the session creation form.
 * Produces an iCal RRULE string from checkbox + time picker inputs.
 *
 * Mobile-first: days displayed as a scrollable chip row on small screens.
 */
export default function RRuleBuilder({
  value,
  startTime,
  endTime,
  validFrom,
  validUntil,
  onRRuleChange,
  onStartTimeChange,
  onEndTimeChange,
  onValidFromChange,
  onValidUntilChange,
}: RRuleBuilderProps) {
  const [frequency, setFrequency] = useState<RRuleFrequency>("weekly");
  const [selectedDays, setSelectedDays] = useState<string[]>(["MO", "WE", "FR"]);

  // Parse initial value once on mount, seeding editable local state from the
  // parent's RRULE string — not a derived value kept in sync on every change,
  // the two effects below own frequency/selectedDays from here on.
  useEffect(() => {
    // COUNT=1 is checked before FREQ=DAILY: a one-off is *stored* as a capped
    // daily rule (see ONCE_RRULE), so testing for FREQ=DAILY first would read
    // every one-time event back as a repeating daily session.
    if (isOneTimeRRule(value)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFrequency("once");
    } else if (value.includes("FREQ=DAILY")) {
      setFrequency("daily");
    } else if (value.includes("BYDAY=")) {
      const match = value.match(/BYDAY=([^;]+)/);
      if (match) setSelectedDays(match[1].split(","));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isOnce = frequency === "once";

  // Rebuild RRULE whenever frequency or days change
  useEffect(() => {
    const rrule = buildRRuleString({ frequency, days: selectedDays });
    onRRuleChange(rrule);
  }, [frequency, selectedDays]); // eslint-disable-line react-hooks/exhaustive-deps

  // A one-off ends the day it happens. COUNT=1 already caps the recurrence, so
  // this is belt-and-braces — but valid_until is what other date-range queries
  // read, and an open-ended one-off would show up as "ongoing".
  useEffect(() => {
    if (isOnce && validFrom && validUntil !== validFrom) onValidUntilChange(validFrom);
  }, [isOnce, validFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDay(code: string) {
    setSelectedDays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
  }

  // Human-readable summary of the current rule
  const dtstart = validFrom
    ? new Date(validFrom + "T" + (startTime || "00:00") + ":00Z").toISOString()
    : new Date().toISOString();
  // rrule's toText() renders COUNT=1 as "every day for 1 time", which is
  // technically true and useless to read. A one-off gets its own wording.
  const summary = isOnce
    ? "Once only"
    : value
      ? formatRRule(value, dtstart)
      : "No days selected";

  return (
    <div className="space-y-5">
      {/* Frequency */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Repeats</p>
        <div className="flex gap-2">
          {[
            { value: "once", label: "Just once" },
            { value: "weekly", label: "Weekly" },
            { value: "daily", label: "Every day" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFrequency(opt.value as RRuleFrequency)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                frequency === opt.value
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Day selector — shown for weekly only */}
      {frequency === "weekly" && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Days *</p>
          {/* Scrollable chip row on mobile */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {DAYS.map((day) => {
              const selected = selectedDays.includes(day.code);
              return (
                <button
                  key={day.code}
                  type="button"
                  onClick={() => toggleDay(day.code)}
                  className={`flex-shrink-0 w-11 h-11 rounded-full text-sm font-medium border-2 transition-colors ${
                    selected
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-gray-200 text-gray-600 hover:border-blue-300"
                  }`}
                  aria-pressed={selected}
                  aria-label={day.label}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          {selectedDays.length === 0 && (
            <p className="text-xs text-red-500 mt-1">Select at least one day.</p>
          )}
        </div>
      )}

      {/* Time range */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Time *</p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">Start</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => onStartTimeChange(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <span className="text-gray-400 mt-5">→</span>
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">End</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => onEndTimeChange(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Dates. A one-off has a date, not a range — showing "starts/ends" for
          something that happens once invites an open-ended range around a
          single occurrence, which then reads as ongoing everywhere else. */}
      {isOnce ? (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Date *</p>
          <input
            type="date"
            value={validFrom}
            onChange={(e) => onValidFromChange(e.target.value)}
            required
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Dates</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Starts *</label>
              <input
                type="date"
                value={validFrom}
                onChange={(e) => onValidFromChange(e.target.value)}
                required
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <span className="text-gray-400 mt-5">→</span>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Ends (optional)</label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => onValidUntilChange(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Leave blank to run indefinitely"
              />
            </div>
          </div>
        </div>
      )}

      {/* Human-readable summary */}
      <div className="p-3 bg-blue-50 rounded-lg">
        <p className="text-xs font-medium text-blue-700 mb-0.5">Schedule summary</p>
        <p className="text-sm text-blue-900 capitalize">{summary}</p>
        {startTime && endTime && (
          <p className="text-sm text-blue-800">
            {startTime} – {endTime}
            {isOnce
              ? validFrom && ` · On ${validFrom}`
              : (
                  <>
                    {validFrom && ` · Starting ${validFrom}`}
                    {validUntil && ` until ${validUntil}`}
                    {!validUntil && validFrom && " · Ongoing"}
                  </>
                )}
          </p>
        )}
      </div>
    </div>
  );
}
