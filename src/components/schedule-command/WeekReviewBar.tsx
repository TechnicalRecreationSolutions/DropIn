"use client";

import { useState } from "react";
import { Check, MessageSquareWarning, RotateCcw } from "lucide-react";
import { useWeekReviews, useSetWeekReview } from "@/hooks/useWeekReviews";
import { WEEK_REVIEW_STATUS_META, type WeekReviewStatus } from "@/lib/schedule/weekReviewStatus";
import { cn } from "@/lib/utils/cn";

interface WeekReviewBarProps {
  scheduleGroupId: string;
  weekStart: Date;
}

/**
 * The per-week admin review control, mounted above the week editor.
 * Separate from schedule_groups.status (draft/published) — see migration
 * 037 — this is the thing that actually gates whether *this specific week*
 * shows on the public schedule/widget once the schedule is published.
 */
export default function WeekReviewBar({ scheduleGroupId, weekStart }: WeekReviewBarProps) {
  const { byWeekStart, isLoading } = useWeekReviews(scheduleGroupId, weekStart, weekStart);
  const setReview = useSetWeekReview();
  const [note, setNote] = useState("");
  const [showNoteFor, setShowNoteFor] = useState<WeekReviewStatus | null>(null);

  const row = [...byWeekStart.values()][0] ?? null;
  const status: WeekReviewStatus = row?.status ?? "pending";
  const meta = WEEK_REVIEW_STATUS_META[status];

  function submit(nextStatus: WeekReviewStatus) {
    setReview.mutate(
      { scheduleGroupId, weekStart, status: nextStatus, note: note.trim() || null },
      {
        onSuccess: () => {
          setShowNoteFor(null);
          setNote("");
        },
      }
    );
  }

  function handleClick(nextStatus: WeekReviewStatus) {
    if (nextStatus === "needs_changes" && showNoteFor !== "needs_changes") {
      setShowNoteFor("needs_changes");
      return;
    }
    submit(nextStatus);
  }

  return (
    <div className="px-4 py-3 border-b border-border bg-muted/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">This week&rsquo;s review:</span>
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border", meta.className)}>
            {isLoading ? "…" : meta.label}
          </span>
          {row?.note && status === "needs_changes" && (
            <span className="text-xs text-amber-700 italic truncate max-w-xs">&ldquo;{row.note}&rdquo;</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleClick("approved")}
            disabled={setReview.isPending || status === "approved"}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-3.5 h-3.5" />
            Approve
          </button>
          <button
            type="button"
            onClick={() => handleClick("needs_changes")}
            disabled={setReview.isPending || status === "needs_changes"}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MessageSquareWarning className="w-3.5 h-3.5" />
            Needs changes
          </button>
          {status !== "pending" && (
            <button
              type="button"
              onClick={() => handleClick("pending")}
              disabled={setReview.isPending}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground bg-card border border-border hover:bg-muted disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to pending
            </button>
          )}
        </div>
      </div>

      {showNoteFor === "needs_changes" && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What needs to change? (optional)"
            className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-amber-400"
            autoFocus
          />
          <button
            type="button"
            onClick={() => submit("needs_changes")}
            disabled={setReview.isPending}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
          >
            Flag week
          </button>
          <button
            type="button"
            onClick={() => setShowNoteFor(null)}
            className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      {setReview.isError && (
        <p className="mt-2 text-xs text-red-600">
          {setReview.error instanceof Error ? setReview.error.message : "Could not save this week's review."}
        </p>
      )}
    </div>
  );
}
