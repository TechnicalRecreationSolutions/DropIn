/**
 * A single week's admin review state — separate from schedule_groups.status
 * (draft/published, which is the schedule *template's* own live/not-live
 * flag). See migration 037: a week with no stored row is 'pending' by
 * definition, never persisted just to mean "not reviewed yet".
 */
export type WeekReviewStatus = "pending" | "approved" | "needs_changes";

export const WEEK_REVIEW_STATUS_META: Record<
  WeekReviewStatus,
  { label: string; className: string }
> = {
  pending: { label: "Pending review", className: "border-transparent bg-muted text-foreground" },
  approved: { label: "Approved", className: "border-transparent bg-success-subtle text-success" },
  needs_changes: { label: "Needs changes", className: "border-transparent bg-warning-subtle text-warning" },
};
