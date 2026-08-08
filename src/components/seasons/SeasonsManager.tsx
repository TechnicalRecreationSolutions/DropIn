"use client";

import { useState } from "react";
import { CalendarRange, Plus, Pencil, Trash2, Copy } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { Season } from "@/lib/seasons/current";
import { formatSeasonRange, seasonTiming, sortSeasons } from "@/lib/seasons/current";
import SeasonFormDialog, { type SeasonFormValues } from "./SeasonFormDialog";
import DeleteSeasonDialog from "./DeleteSeasonDialog";

/** A season plus how much of the schedule is riding on it. */
export type SeasonWithUsage = Season & { session_count: number };

interface SeasonsManagerProps {
  initialSeasons: SeasonWithUsage[];
  /** Members can see seasons but not create or re-date them (owner/admin, per migration 027). */
  canManage: boolean;
}

const STATUS_STYLES: Record<Season["status"], { label: string; className: string }> = {
  planning: { label: "Planning", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  active: { label: "Published", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  archived: { label: "Archived", className: "bg-gray-100 text-gray-500 ring-gray-200" },
};

/**
 * The season list and its create/edit/delete flows.
 *
 * The list is seeded from the server and then maintained locally from each
 * mutation's response, rather than refetching the route. Seasons are a short,
 * bounded list that only this page writes to, so a round trip after every edit
 * would be pure latency.
 */
export default function SeasonsManager({ initialSeasons, canManage }: SeasonsManagerProps) {
  const [seasons, setSeasons] = useState<SeasonWithUsage[]>(initialSeasons);
  const [editing, setEditing] = useState<{ season: SeasonWithUsage | null; prefill?: SeasonFormValues } | null>(null);
  const [deleting, setDeleting] = useState<SeasonWithUsage | null>(null);

  function upsert(season: Season) {
    setSeasons((prev) => {
      const existing = prev.find((s) => s.id === season.id);
      const next: SeasonWithUsage = { ...season, session_count: existing?.session_count ?? 0 };
      const merged = existing
        ? prev.map((s) => (s.id === season.id ? next : s))
        : [...prev, next];
      return sortSeasons(merged);
    });
  }

  function handleDeleted(id: string) {
    setSeasons((prev) => prev.filter((s) => s.id !== id));
  }

  /**
   * "Duplicate" prefills the create form a year on rather than writing a copy.
   * A season owns nothing yet at this stage — it's a name, a range, and a
   * status — so a silent copy would just be a row the user then has to open
   * and edit anyway. Once seasons carry task checklists this becomes a real
   * copy operation, and that's the point to revisit it.
   */
  function handleDuplicate(season: SeasonWithUsage) {
    setEditing({
      season: null,
      prefill: {
        name: nextYearName(season.name),
        description: season.description ?? "",
        starts_on: shiftYear(season.starts_on),
        ends_on: shiftYear(season.ends_on),
        status: "planning",
      },
    });
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing({ season: null })}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New season
          </button>
        </div>
      )}

      {seasons.length === 0 ? (
        <EmptyState canManage={canManage} onCreate={() => setEditing({ season: null })} />
      ) : (
        <ul className="space-y-3">
          {seasons.map((season) => {
            const status = STATUS_STYLES[season.status];
            const timing = seasonTiming(season);
            return (
              <li
                key={season.id}
                className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-gray-900 truncate">{season.name}</h2>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                        status.className
                      )}
                    >
                      {status.label}
                    </span>
                    {timing === "current" && season.status === "active" && (
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                        On now
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
                    <CalendarRange className="w-3.5 h-3.5 shrink-0" />
                    {formatSeasonRange(season)}
                    <span aria-hidden="true">·</span>
                    <span>
                      {season.session_count} {season.session_count === 1 ? "session" : "sessions"}
                    </span>
                  </p>
                  {season.description && (
                    <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">{season.description}</p>
                  )}
                </div>

                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <IconAction label={`Edit ${season.name}`} onClick={() => setEditing({ season })}>
                      <Pencil className="w-4 h-4" />
                    </IconAction>
                    <IconAction
                      label={`Duplicate ${season.name}`}
                      onClick={() => handleDuplicate(season)}
                    >
                      <Copy className="w-4 h-4" />
                    </IconAction>
                    <IconAction
                      label={`Delete ${season.name}`}
                      destructive
                      onClick={() => setDeleting(season)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </IconAction>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <SeasonFormDialog
        open={!!editing}
        season={editing?.season ?? null}
        prefill={editing?.prefill}
        onClose={() => setEditing(null)}
        onSaved={(season) => {
          upsert(season);
          setEditing(null);
        }}
      />

      <DeleteSeasonDialog
        season={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          handleDeleted(id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function IconAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        // 44px tap target — the dashboard's mobile minimum.
        "inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg transition-colors",
        destructive
          ? "text-gray-400 hover:text-red-600 hover:bg-red-50"
          : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({ canManage, onCreate }: { canManage: boolean; onCreate: () => void }) {
  return (
    <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
      <CalendarRange className="w-10 h-10 text-gray-300 mx-auto mb-3" />
      <h2 className="font-medium text-gray-900 mb-1">No seasons yet</h2>
      <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto px-4">
        Add the period you&rsquo;re planning — a term, a summer, a program year. Sessions you place
        while a season is selected are assigned to it automatically.
      </p>
      {canManage && (
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New season
        </button>
      )}
    </div>
  );
}

/** "Fall 2026" → "Fall 2027". Leaves anything without a 4-digit year alone. */
function nextYearName(name: string): string {
  return name.replace(/\b(20\d{2})\b/, (year) => String(Number(year) + 1));
}

/**
 * Shifts a YYYY-MM-DD string forward one year, as a string — see the
 * date-handling note in lib/seasons/current.ts.
 *
 * Feb 29 is clamped to Feb 28, because next year is not a leap year by
 * definition and "2027-02-29" is not a date Postgres will accept.
 */
function shiftYear(date: string): string {
  const next = `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
  return next.endsWith("-02-29") ? next.replace("-02-29", "-02-28") : next;
}
