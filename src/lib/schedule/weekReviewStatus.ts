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
  pending: { label: "Pending review", className: "bg-gray-100 text-gray-600 border-gray-200" },
  approved: { label: "Approved", className: "bg-green-50 text-green-700 border-green-200" },
  needs_changes: { label: "Needs changes", className: "bg-amber-50 text-amber-700 border-amber-200" },
};
