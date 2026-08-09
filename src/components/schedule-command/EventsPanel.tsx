"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink, Info } from "lucide-react";
import { useTemplateSchedule } from "@/hooks/useScheduleRange";
import ScheduleView from "@/components/schedule/ScheduleView";
import { ScheduleEditingProvider, type ScheduleEditingApi } from "@/components/schedule/editing/ScheduleEditingContext";
import { formatMonthLabel } from "@/lib/utils/dates";

interface EventsPanelProps {
  orgId: string;
  orgSlug: string;
  orgName: string;
  orgLogoUrl: string | null;
  /** Any date inside the month in view — shared with the schedule tab's anchor. */
  month: Date;
  onMonthChange: (month: Date) => void;
  /** The scoped editing API from the command centre; narrowed here. */
  editing: ScheduleEditingApi;
}

/**
 * The Events workspace — the org-wide "what's happening" calendar.
 *
 * This is the one tab that ignores the facility/department scope above it, and
 * that is the entire reason it exists as a tab rather than only as a layout on
 * the Schedule tab. The two answer different questions:
 *
 *   Schedule tab, "events" layout   what will visitors to *this building* see?
 *   Events tab                      what is happening across the *whole org*?
 *
 * The second is the printed sheet taped to a wall, and it is the one the
 * command centre could not previously show at all, because its scope is always
 * a single facility. An org running a pool, an arena and a hall gets one page
 * with all three on it.
 *
 * Editing is narrowed rather than removed. Featuring, un-featuring, editing
 * copy and removing a series are all valid on any session from any building.
 * Duplicating is not: it offers `spaces`, which is one facility's list, so
 * `canDuplicate` is false here and the menu item withdraws itself.
 */
export default function EventsPanel({
  orgId,
  orgSlug,
  orgName,
  orgLogoUrl,
  month,
  onMonthChange,
  editing,
}: EventsPanelProps) {
  const { data: sessions, isLoading, isError } = useTemplateSchedule({
    template: "events",
    orgId,
    // The events template derives its range from `month`; `weekStart` is unused
    // on this path but the hook's shape is shared with the week views.
    weekStart: month,
    month,
  });

  const eventsEditing = useMemo<ScheduleEditingApi>(
    () => ({
      ...editing,
      // Placing a session needs exactly one schedule group, and this view spans
      // every schedule in the org.
      canCreate: false,
      canDuplicate: false,
      templates: [],
      spaces: [],
    }),
    [editing]
  );

  const facilityCount = useMemo(
    () => new Set((sessions ?? []).map((s) => s.facilityId)).size,
    [sessions]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-gray-500 flex-1 min-w-0">
          Everything flagged for the event calendar, across every building — this tab ignores
          the facility filter above.{" "}
          {sessions && sessions.length > 0 && (
            <span className="text-gray-400">
              {sessions.length} {sessions.length === 1 ? "event" : "events"} in{" "}
              {formatMonthLabel(month)} across {facilityCount}{" "}
              {facilityCount === 1 ? "location" : "locations"}.
            </span>
          )}
        </p>
        <Link
          href={`/org/${orgSlug}/events`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0"
        >
          Public page <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">
            Loading events…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-16 text-sm text-red-500">
            Could not load events. Please refresh.
          </div>
        ) : (
          // No empty short-circuit: the calendar owns its empty state, below its
          // own month navigator, so an empty month is still one you can page out of.
          <ScheduleEditingProvider value={eventsEditing}>
            <ScheduleView
              template="events"
              sessions={sessions ?? []}
              weekStart={month}
              onWeekChange={onMonthChange}
              month={month}
              onMonthChange={onMonthChange}
              // This tab is where staff actually print the wall sheet, so it
              // carries the org's identity onto paper — unlike the Schedule
              // tab's scoped preview, which is about one building.
              printBranding={{ name: orgName, logoUrl: orgLogoUrl }}
            />
          </ScheduleEditingProvider>
        )}
      </div>

      <p className="flex items-start gap-2 text-xs text-gray-500 px-1">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Add a session here from the Schedule tab: open its{" "}
          <span className="font-medium">⋯</span> menu and choose{" "}
          <span className="font-medium">Add to event calendar</span>, or{" "}
          <span className="font-medium">Feature…</span> to write the blurb, image and colour
          that appear on the calendar and in a brochure.
        </span>
      </p>
    </div>
  );
}
