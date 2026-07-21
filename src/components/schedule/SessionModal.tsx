"use client";

import { X, Clock, MapPin, DollarSign, Users, Tag } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime, formatDayFull } from "@/lib/utils/dates";
import { getSportCategory } from "@/lib/utils/sport-categories";

interface SessionModalProps {
  session: ExpandedSession;
  onClose: () => void;
}

/**
 * Click-through session detail modal for the public schedule view.
 * Opens when a session block is tapped/clicked in WeeklyScheduleGrid.
 */
export default function SessionModal({ session, onClose }: SessionModalProps) {
  const sport = getSportCategory(session.sportCategory);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={session.programName}
      >
        {/* Sheet (mobile: slides from bottom; desktop: centered card) */}
        <div
          className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle (mobile) */}
          <div className="sm:hidden flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-gray-300 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-start justify-between p-5 pb-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{session.programName}</h2>
              <p className="text-sm text-gray-500 capitalize mt-0.5">
                {sport?.label ?? session.sportCategory} · {session.activityType.replace("_", " ")}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 -mt-1 -mr-1"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Details */}
          <div className="px-5 pb-6 space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Clock className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-gray-700">
                {formatDayFull(session.start)} · {formatTime(session.start)} – {formatTime(session.end)}
              </span>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-gray-700">
                {session.facilityName}
                {session.locationDetail && ` · ${session.locationDetail}`}
              </span>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <DollarSign className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-gray-700">
                {session.costCents === 0
                  ? "Free admission"
                  : `$${(session.costCents / 100).toFixed(2)} drop-in`}
                {session.costNotes && ` · ${session.costNotes}`}
              </span>
            </div>

            {(session.ageGroup || session.skillLevel) && (
              <div className="flex items-center gap-3 text-sm">
                <Tag className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-gray-700 capitalize">
                  {[session.ageGroup, session.skillLevel]
                    .filter(Boolean)
                    .map((v) => v!.replace("_", " "))
                    .join(" · ")}
                </span>
              </div>
            )}

            {session.maxParticipants && (
              <div className="flex items-center gap-3 text-sm">
                <Users className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-gray-700">Max {session.maxParticipants} participants</span>
              </div>
            )}

            {session.isModified && session.modificationNote && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                {session.modificationNote}
              </div>
            )}

            {session.source === "scraped" && session.lastSyncedAt && (
              <p className="text-xs text-gray-400">
                Data synced from source · Last updated {new Date(session.lastSyncedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
