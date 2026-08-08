"use client";

import Link from "next/link";
import { CalendarRange, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { SeasonSummary } from "@/lib/seasons/current";
import { formatSeasonRange, seasonContainsDate } from "@/lib/seasons/current";
import { localDateString } from "@/lib/utils/dates";

interface SeasonPickerProps {
  seasons: SeasonSummary[];
  selectedSeasonId: string | null;
  onChange: (seasonId: string | null) => void;
  /** The week currently on screen, so the picker can say when you're looking outside the season. */
  weekStart: Date;
  onJumpToSeason: () => void;
}

/**
 * Picks the planning period the command centre is working in.
 *
 * What selecting a season does — and deliberately does not do:
 *
 *   **Does**: set the defaults for everything placed from here. New sessions
 *   are assigned to the season and dated to its range, which is the whole
 *   reason the season exists: nobody wants to retype "Sep 8 to Dec 20" forty
 *   times, and nobody will remember to backfill season_id later.
 *
 *   **Does not**: filter the schedule down to that season's sessions. Every
 *   session that predates seasons has season_id NULL, so a hard filter would
 *   turn the grid black for every existing org the moment they created their
 *   first season — an empty schedule reads as data loss, not as a filter.
 *   The season is a lens on new work, not a gate on old work.
 *
 * Weeks stay freely navigable for the same reason; the picker just says so
 * when the week on screen falls outside the season, and offers a jump back.
 */
export default function SeasonPicker({
  seasons,
  selectedSeasonId,
  onChange,
  weekStart,
  onJumpToSeason,
}: SeasonPickerProps) {
  const selected = seasons.find((s) => s.id === selectedSeasonId) ?? null;
  const weekOutsideSeason = selected
    ? !seasonContainsDate(selected, localDateString(weekStart))
    : false;

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <label
        htmlFor="command-season"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 shrink-0"
      >
        <CalendarRange className="w-3.5 h-3.5" />
        Season
      </label>

      <select
        id="command-season"
        value={selectedSeasonId ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        <option value="">No season</option>
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
            {season.status === "planning" ? " (planning)" : ""}
            {season.status === "archived" ? " (archived)" : ""}
          </option>
        ))}
      </select>

      {selected ? (
        <p className="text-xs text-gray-500 flex-1 min-w-0">
          {formatSeasonRange(selected)} — new sessions are assigned to {selected.name} and dated to
          it.
        </p>
      ) : (
        <p className="text-xs text-gray-500 flex-1 min-w-0">
          Pick one to date new sessions automatically and group them for brochures and calendars.
        </p>
      )}

      {weekOutsideSeason && (
        <button
          type="button"
          onClick={onJumpToSeason}
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium",
            "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100 transition-colors"
          )}
        >
          This week is outside {selected?.name} — jump to it
        </button>
      )}

      <Link
        href="/dashboard/seasons"
        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
      >
        Manage
        <ExternalLink className="w-3 h-3" />
      </Link>
    </div>
  );
}
