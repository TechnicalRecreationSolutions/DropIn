"use client";

import { useEffect, useRef } from "react";
import { X, Clock, MapPin, DollarSign, Users, Tag, Trash2 } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatSessionTime, formatSessionDayFull } from "@/lib/utils/dates";
import { getSportCategory } from "@/lib/utils/sport-categories";

interface SessionModalProps {
  session: ExpandedSession;
  onClose: () => void;
  /** Staff-only: when provided, shows a delete action for this recurring session. */
  onDelete?: (session: ExpandedSession) => void;
  isDeleting?: boolean;
}

/**
 * Click-through session detail modal for the public schedule view.
 * Opens when a session block is tapped/clicked in WeeklyScheduleGrid.
 */
export default function SessionModal({ session, onClose, onDelete, isDeleting }: SessionModalProps) {
  const sport = getSportCategory(session.sportCategory);

  // Fires once per open, and only for visitors — `onDelete` is only ever
  // passed by the dashboard command centre's staff preview, and a staff
  // member checking their own schedule isn't a "click" worth counting.
  const trackedKey = useRef<string | null>(null);
  useEffect(() => {
    if (onDelete || trackedKey.current === session.key) return;
    trackedKey.current = session.key;
    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "program_click",
        orgId: session.orgId,
        facilityId: session.facilityId,
        scheduleGroupId: session.scheduleGroupId,
        referrer: document.referrer || null,
        pathname: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {});
    // Only re-fires when a different session opens in the same mounted modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.key]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={session.templateName ?? session.scheduleGroupName}
      >
        {/* Sheet (mobile: slides from bottom; desktop: centered card) */}
        <div
          className="bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle (mobile) */}
          <div className="sm:hidden flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-muted rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-start justify-between p-5 pb-3">
            <div>
              <h2 className="text-lg font-bold text-foreground">{session.templateName ?? session.scheduleGroupName}</h2>
              <p className="text-sm text-muted-foreground capitalize mt-0.5">
                {session.templateName && `${session.scheduleGroupName} · `}
                {sport?.label ?? session.sportCategory} · {session.activityType.replace("_", " ")}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground/70 -mt-1 -mr-1"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Details */}
          <div className="px-5 pb-6 space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Clock className="w-4 h-4 text-muted-foreground/70 shrink-0" />
              <span className="text-foreground">
                {formatSessionDayFull(session.start)} ·{" "}
                {formatSessionTime(session.start)} – {formatSessionTime(session.end)}
              </span>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground/70 shrink-0" />
              <span className="text-foreground">
                {[session.facilityName, session.spaceNames.join(", "), session.locationDetail]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <DollarSign className="w-4 h-4 text-muted-foreground/70 shrink-0" />
              <span className="text-foreground">
                {session.costCents === 0
                  ? "Free admission"
                  : `$${(session.costCents / 100).toFixed(2)} drop-in`}
                {session.costNotes && ` · ${session.costNotes}`}
              </span>
            </div>

            {(session.ageGroup || session.skillLevel) && (
              <div className="flex items-center gap-3 text-sm">
                <Tag className="w-4 h-4 text-muted-foreground/70 shrink-0" />
                <span className="text-foreground capitalize">
                  {[session.ageGroup, session.skillLevel]
                    .filter(Boolean)
                    .map((v) => v!.replace("_", " "))
                    .join(" · ")}
                </span>
              </div>
            )}

            {session.maxParticipants && (
              <div className="flex items-center gap-3 text-sm">
                <Users className="w-4 h-4 text-muted-foreground/70 shrink-0" />
                <span className="text-foreground">Max {session.maxParticipants} participants</span>
              </div>
            )}

            {session.isModified && session.modificationNote && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                {session.modificationNote}
              </div>
            )}

            {onDelete && (
              <button
                onClick={() => onDelete(session)}
                disabled={isDeleting}
                className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? "Removing…" : "Remove recurring session"}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
