"use client";

import { useState } from "react";
import { Check, MessageSquareWarning, RotateCcw } from "lucide-react";
import { useWeekReviews, useSetWeekReview } from "@/hooks/useWeekReviews";
import { WEEK_REVIEW_STATUS_META, type WeekReviewStatus } from "@/lib/schedule/weekReviewStatus";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface WeekReviewBarProps {
  scheduleGroupId: string;
  weekStart: Date;
  /** False for read-only staff: they see the week's review status, not the
   *  Approve / Needs changes / Reset controls (week-review:write would 403). */
  canEdit?: boolean;
}

/**
 * The per-week admin review control, mounted above the week editor.
 * Separate from schedule_groups.status (draft/published) — see migration
 * 037 — this is the thing that actually gates whether *this specific week*
 * shows on the public schedule/widget once the schedule is published.
 */
export default function WeekReviewBar({ scheduleGroupId, weekStart, canEdit = true }: WeekReviewBarProps) {
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
            <span className="text-xs text-warning italic truncate max-w-xs">&ldquo;{row.note}&rdquo;</span>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleClick("approved")}
              disabled={setReview.isPending || status === "approved"}
            >
              <Check className="w-3.5 h-3.5 text-success" />
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleClick("needs_changes")}
              disabled={setReview.isPending || status === "needs_changes"}
            >
              <MessageSquareWarning className="w-3.5 h-3.5 text-warning" />
              Needs changes
            </Button>
            {status !== "pending" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleClick("pending")}
                disabled={setReview.isPending}
                className="text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to pending
              </Button>
            )}
          </div>
        )}
      </div>

      {canEdit && showNoteFor === "needs_changes" && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What needs to change? (optional)"
            className="h-8 flex-1"
            autoFocus
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => submit("needs_changes")}
            disabled={setReview.isPending}
          >
            Flag week
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowNoteFor(null)}
          >
            Cancel
          </Button>
        </div>
      )}

      {setReview.isError && (
        <p className="mt-2 text-xs text-destructive">
          {setReview.error instanceof Error ? setReview.error.message : "Could not save this week's review."}
        </p>
      )}
    </div>
  );
}
