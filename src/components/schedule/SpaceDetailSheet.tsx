"use client";

import { X, Clock, DollarSign, Tag, Users } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime } from "@/lib/utils/dates";

interface SpaceDetailSheetProps {
  spaceName: string;
  spaceCapacity: number | null;
  /** The session in progress in this space at the viewed time, if any. */
  liveSession: ExpandedSession | null;
  /** The next session starting in this space after the viewed time (today), if any. */
  nextSession: ExpandedSession | null;
  /** True when the floorplan's time control is at the real current moment. */
  viewingNow: boolean;
  /** The viewed time, for labeling when scrubbed away from now (e.g. "3:15 PM"). */
  viewedTimeLabel: string;
  onClose: () => void;
}

function costLine(session: ExpandedSession): string {
  const base =
    session.costCents === 0 ? "Free admission" : `$${(session.costCents / 100).toFixed(2)} drop-in`;
  return session.costNotes ? `${base} · ${session.costNotes}` : base;
}

/** Icon + text row, matching SessionModal's detail-row idiom. */
function DetailRow({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="w-4 h-4 text-gray-400 shrink-0" />
      <span className="text-gray-700">{children}</span>
    </div>
  );
}

/**
 * Bottom sheet (mobile) / centered card (desktop) shown when a visitor taps
 * a space on the facility floorplan. Scope is "what's in this spot at the
 * viewed time, and what's next" — richer than the old popover (cost, age/
 * skill, capacity now shown, since the visitor tapping a pool lane is
 * usually deciding whether to walk over), but still lighter than
 * SessionModal, which stays the week-schedule's full detail view.
 */
export default function SpaceDetailSheet({
  spaceName,
  spaceCapacity,
  liveSession,
  nextSession,
  viewingNow,
  viewedTimeLabel,
  onClose,
}: SpaceDetailSheetProps) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={spaceName}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{spaceName}</h2>
            {!viewingNow && (
              <p className="text-xs font-medium text-amber-700 mt-0.5">
                Viewing {viewedTimeLabel} — not the current time
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 -mt-1 -mr-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-6 space-y-3">
          {liveSession ? (
            <>
              <span
                className="inline-block text-[10px] font-bold uppercase tracking-wide text-white px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "var(--org-accent, #2563eb)" }}
              >
                {viewingNow ? "On now" : `On at ${viewedTimeLabel}`}
              </span>
              <p className="text-base font-semibold text-gray-900">
                {liveSession.templateName ?? liveSession.scheduleGroupName}
              </p>
              <DetailRow icon={Clock}>
                {formatTime(liveSession.start)} – {formatTime(liveSession.end)}
                {viewingNow && ` · ends ${formatTime(liveSession.end)}`}
              </DetailRow>
              <DetailRow icon={DollarSign}>{costLine(liveSession)}</DetailRow>
              {(liveSession.ageGroup || liveSession.skillLevel) && (
                <DetailRow icon={Tag}>
                  <span className="capitalize">
                    {[liveSession.ageGroup, liveSession.skillLevel]
                      .filter(Boolean)
                      .map((v) => v!.replace("_", " "))
                      .join(" · ")}
                  </span>
                </DetailRow>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">
              {viewingNow ? "Free right now." : `Free at ${viewedTimeLabel}.`}
            </p>
          )}

          {nextSession && (
            <div className="pt-3 border-t border-gray-100 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Next up here</p>
              <p className="text-sm font-semibold text-gray-900">
                {nextSession.templateName ?? nextSession.scheduleGroupName}
              </p>
              <p className="text-sm text-gray-500">
                Starts {formatTime(nextSession.start)} · {costLine(nextSession)}
              </p>
            </div>
          )}

          {!liveSession && !nextSession && (
            <p className="text-xs text-gray-400">Nothing else scheduled here today.</p>
          )}

          {spaceCapacity != null && (
            <DetailRow icon={Users}>Capacity {spaceCapacity}</DetailRow>
          )}
        </div>
      </div>
    </div>
  );
}
