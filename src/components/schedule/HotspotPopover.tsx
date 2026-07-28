"use client";

import { X } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime } from "@/lib/utils/dates";

interface HotspotPopoverProps {
  spaceName: string;
  spaceCapacity: number | null;
  /** The live session at the viewed time, if any (see getSessionLiveStatus). */
  liveSession: ExpandedSession | null;
  /** True when the floorplan's time scrubber is at the real current moment; false when scrubbed elsewhere. */
  viewingNow: boolean;
  onClose: () => void;
}

/**
 * Small popover shown when a visitor taps a hotspot on the facility
 * floorplan — deliberately lighter than SessionModal, since the floorplan's
 * scope is "what's here at the viewed time", not the full session detail.
 */
export default function HotspotPopover({ spaceName, spaceCapacity, liveSession, viewingNow, onClose }: HotspotPopoverProps) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={spaceName}
    >
      <div
        className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="flex items-start justify-between p-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900">{spaceName}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 -mt-1 -mr-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-6 space-y-2">
          {liveSession ? (
            <>
              <span
                className="inline-block text-[10px] font-bold uppercase tracking-wide text-white px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "var(--org-accent, #2563eb)" }}
              >
                {viewingNow ? "On now" : `Live at ${formatTime(liveSession.start)}`}
              </span>
              <p className="text-sm font-semibold text-gray-900">
                {liveSession.templateName ?? liveSession.scheduleGroupName}
              </p>
              <p className="text-sm text-gray-500">
                {formatTime(liveSession.start)} – {formatTime(liveSession.end)}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400">
              {viewingNow ? "No live session right now." : "No live session at this time."}
            </p>
          )}

          {spaceCapacity != null && (
            <p className="text-xs text-gray-400">Capacity {spaceCapacity}</p>
          )}
        </div>
      </div>
    </div>
  );
}
