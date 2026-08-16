"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import type { BrochureCandidate } from "@/lib/brochure/candidates";

interface CandidateRailProps {
  candidates: BrochureCandidate[];
  sections: { id: string; title: string }[];
  onPull: (sourceIds: string[], sectionId: string | null) => Promise<void>;
  pulling: boolean;
  seasonName: string | null;
}

/**
 * The "Suggested" rail — candidacy made visible.
 *
 * Everything here is computed live from a session's `in_brochure` flag plus
 * the season window, and nothing in it is part of the brochure until someone
 * pulls it. That distinction is the point of the whole model, so the rail
 * states it rather than leaving staff to infer it from behaviour.
 *
 * Candidates already handled stay listed, greyed, with why — "in the brochure"
 * or "removed". Hiding them would make the rail look like it had lost track of
 * something staff can plainly see on the page, and hiding *dismissed* ones
 * would make a tombstone invisible right where its effect matters.
 */
export default function CandidateRail({
  candidates,
  sections,
  onPull,
  pulling,
  seasonName,
}: CandidateRailProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetSection, setTargetSection] = useState<string>("");

  const available = useMemo(() => candidates.filter((c) => c.existing === null), [candidates]);
  const handled = useMemo(() => candidates.filter((c) => c.existing !== null), [candidates]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function pullSelected() {
    if (selected.size === 0) return;
    await onPull([...selected], targetSection || null);
    setSelected(new Set());
  }

  return (
    <aside className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-semibold text-gray-900">
          <Sparkles className="w-4 h-4 text-blue-500" />
          Suggested
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Flagged for brochures{seasonName ? ` and overlapping ${seasonName}` : ""}. Nothing here
          is in the brochure until you add it.
        </p>
      </div>

      {available.length === 0 && handled.length === 0 ? (
        <p className="text-xs text-gray-500 py-6 text-center">
          Nothing is flagged yet. Use <span className="font-medium">Feature…</span> on a session,
          and it will show up here.
        </p>
      ) : (
        <>
          {available.length > 0 && (
            <>
              <ul className="space-y-1 max-h-96 overflow-y-auto -mx-1 px-1">
                {available.map((candidate) => {
                  const isSelected = selected.has(candidate.sourceId);
                  return (
                    <li key={candidate.sourceId}>
                      <button
                        type="button"
                        onClick={() => toggle(candidate.sourceId)}
                        aria-pressed={isSelected}
                        className={cn(
                          "w-full text-left flex items-start gap-2 p-2 rounded-lg border-2 transition-colors",
                          isSelected
                            ? "border-blue-600 bg-blue-50"
                            : "border-transparent hover:bg-gray-50"
                        )}
                      >
                        <CalendarDays className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900 truncate">
                            {candidate.title}
                          </span>
                          <span className="block text-xs text-gray-500 truncate">
                            Session
                            {candidate.facilityName ? ` · ${candidate.facilityName}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="space-y-2 pt-1 border-t border-gray-100">
                {sections.length > 0 && (
                  <select
                    value={targetSection}
                    onChange={(e) => setTargetSection(e.target.value)}
                    aria-label="Add to section"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Unfiled</option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        Into &ldquo;{section.title}&rdquo;
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  onClick={pullSelected}
                  disabled={pulling || selected.size === 0}
                  className="w-full"
                >
                  {pulling
                    ? "Adding…"
                    : selected.size === 0
                      ? "Select something to add"
                      : `Add ${selected.size} to the brochure`}
                </Button>
              </div>
            </>
          )}

          {handled.length > 0 && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                Already handled
              </p>
              <ul className="space-y-0.5">
                {handled.map((candidate) => (
                  <li
                    key={candidate.sourceId}
                    className="flex items-center gap-2 text-xs text-gray-400 px-2 py-1"
                  >
                    <span className="flex-1 truncate">{candidate.title}</span>
                    <span className="shrink-0">
                      {candidate.existing === "included" ? "in brochure" : "removed"}
                    </span>
                  </li>
                ))}
              </ul>
              {handled.some((c) => c.existing === "dismissed") && (
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Removed items stay out even if you add everything again. Restore one from the
                  Removed list below the sections.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
