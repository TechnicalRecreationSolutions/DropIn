"use client";

import { useCallback, useEffect, useRef } from "react";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { X, Clock, ClipboardList, MapPin, DollarSign, Users, Tag, Trash2, ExternalLink } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatSessionTime, formatSessionDayFull } from "@/lib/utils/dates";
import { getSportCategory } from "@/lib/utils/sport-categories";
import SessionTags from "./SessionTags";

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

  // `onDelete` is only ever passed by the dashboard command centre's staff
  // preview, so its presence is what distinguishes staff from a visitor — a
  // staff member checking their own schedule isn't a "click" worth counting,
  // and the same goes for them following a registration link to test it.
  const isStaffView = !!onDelete;

  // One shape for both events, so link_click carries exactly the attribution
  // program_click does and the two stay comparable in the analytics summary.
  // A click's whole value is the ratio between them.
  const track = useCallback(
    (event: "program_click" | "link_click") => {
      if (isStaffView) return;
      fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event,
          orgId: session.orgId,
          facilityId: session.facilityId,
          scheduleGroupId: session.scheduleGroupId,
          referrer: document.referrer || null,
          pathname: window.location.pathname,
        }),
        // Set for link_click above all: the click is about to navigate this
        // tab's opener away in some browsers, and an in-flight fetch without
        // it is cancelled — the exact click we most wanted to count.
        keepalive: true,
      }).catch(() => {});
    },
    [isStaffView, session.orgId, session.facilityId, session.scheduleGroupId]
  );

  // Fires once per open, and only for visitors.
  const trackedKey = useRef<string | null>(null);
  useEffect(() => {
    if (isStaffView || trackedKey.current === session.key) return;
    trackedKey.current = session.key;
    track("program_click");
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
        aria-label={sessionDisplayLabel(session)}
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
              <h2 className="text-lg font-bold text-foreground">{sessionDisplayLabel(session)}</h2>
              <p className="text-sm text-muted-foreground capitalize mt-0.5">
                {session.templateName && `${session.scheduleGroupName} · `}
                {sport?.label ?? session.sportCategory} · {session.activityType.replace("_", " ")}
              </p>
              {/* Every tag, not just the two a card had room for — this is
                  where the "+N" on the card leads. */}
              <SessionTags tags={session.templateTags} variant="full" className="mt-2" />
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
            {/* Staff-only block (migration 046). Rendering it on `setupNotes`
                being present is itself the audience check: setupNotes only ever
                arrives for a member of the owning org, because it comes from
                session_internal via /api/sessions/expand. This same modal opens
                on the public widget, where the field is always null. */}
            {session.setupNotes && (
              <div className="flex items-start gap-3 text-sm rounded-lg bg-muted/50 border border-border p-3">
                <ClipboardList className="w-4 h-4 text-muted-foreground/70 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Setup — staff only</p>
                  <p className="text-foreground mt-0.5 whitespace-pre-line">{session.setupNotes}</p>
                </div>
              </div>
            )}

            {/* The template's description (migration 050). Plain text by
                design — no markdown renderer on a public surface — so
                whitespace-pre-line is what preserves the line breaks staff
                typed. Sits above the facts because it is the sentence that
                explains what the session *is*; the time and place below answer
                a question the visitor already knows they have. */}
            {session.templateDescription && (
              <p className="text-sm text-foreground whitespace-pre-line">
                {session.templateDescription}
              </p>
            )}

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
                {[
                  session.facilityName,
                  session.spaceNames.join(", "),
                  session.locationDetail,
                ]
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

            {/* Registration links (migration 050). At most three, ordered by
                staff, and always rendered as their label — a bare URL is
                unreadable and tells a visitor nothing about what happens when
                they tap it.

                rel="noopener noreferrer" is not optional here: these URLs are
                staff-entered and point off-site, and without noopener the
                destination gets a handle on this window via window.opener. */}
            {session.templateLinks.length > 0 && (
              <div className="space-y-2 pt-1">
                {session.templateLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track("link_click")}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-white rounded-lg hover:brightness-95 transition-all"
                    style={{ backgroundColor: "var(--org-primary, #2563eb)" }}
                  >
                    {link.label}
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>
                ))}
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
