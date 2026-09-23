import type { FacilityNotice, NoticeCategory, NoticeSeverity } from "@/types/app.types";

/**
 * The facility-notice domain: the two axes, how they render, and what "live"
 * means.
 *
 * Three surfaces draw a notice — the public facility page, the embedded widget
 * and the staff status page — and two more decide whether one exists at all
 * (the API route's validation, and the Overview's alert row). A closure that is
 * red in one place and amber in another, or live in one and finished in
 * another, is a bug no reviewer catches by reading either file alone. So all of
 * it is here.
 *
 * The presets that pre-fill a new notice are next door in `notice-presets.ts`.
 *
 * Client-safe: no imports from the server, so the same predicate runs in the
 * public page's server render and in the staff page's client list.
 */

/**
 * Every `category` the CHECK constraint in migration 060 allows.
 *
 * A runtime array rather than only a type, because the API route needs
 * `z.enum()` over exactly this list. Keeping the two in sync by hand is the
 * thing this avoids: `satisfies` below makes a divergence a compile error.
 */
export const NOTICE_CATEGORIES = [
  "water_quality",
  "mechanical",
  "staffing",
  "weather",
  "maintenance",
  "capacity",
  "power",
  "other",
] as const satisfies readonly NoticeCategory[];

export const NOTICE_SEVERITIES = [
  "info",
  "caution",
  "closure",
] as const satisfies readonly NoticeSeverity[];

export const CATEGORY_LABEL: Record<NoticeCategory, string> = {
  water_quality: "Water quality",
  mechanical: "Mechanical",
  staffing: "Staffing",
  weather: "Weather",
  maintenance: "Maintenance",
  capacity: "Capacity",
  power: "Power",
  other: "Other",
};

/**
 * What each severity is called where a patron reads it.
 *
 * Not the raw column value: "closure" is a noun about the facility, and the
 * badge has to be a word about the patron's afternoon.
 */
export const SEVERITY_LABEL: Record<NoticeSeverity, string> = {
  info: "Notice",
  caution: "Caution",
  closure: "Closed",
};

/**
 * Most serious first. Used wherever notices are listed: a closure must never
 * sort below an advisory, whatever their timestamps say.
 */
export const SEVERITY_RANK: Record<NoticeSeverity, number> = {
  closure: 0,
  caution: 1,
  info: 2,
};

/** The window a notice is `live` in — the same predicate as 060's read policy. */
export function isNoticeLive(
  notice: Pick<FacilityNotice, "starts_at" | "ends_at" | "is_published">,
  now: Date = new Date()
): boolean {
  if (!notice.is_published) return false;
  if (new Date(notice.starts_at) > now) return false;
  if (notice.ends_at && new Date(notice.ends_at) <= now) return false;
  return true;
}

/** A published notice whose window has not opened yet. */
export function isNoticeScheduled(
  notice: Pick<FacilityNotice, "starts_at" | "is_published">,
  now: Date = new Date()
): boolean {
  return notice.is_published && new Date(notice.starts_at) > now;
}

/** A notice whose window has closed, published or not. */
export function isNoticeFinished(
  notice: Pick<FacilityNotice, "ends_at">,
  now: Date = new Date()
): boolean {
  return notice.ends_at != null && new Date(notice.ends_at) <= now;
}

/**
 * Reading order for a list of notices: worst first, then most recent.
 *
 * Returns a new array — the staff page holds its list in React state, and
 * sorting in place there is the mutation that makes a row flicker without
 * re-rendering.
 */
export function sortNotices<T extends Pick<FacilityNotice, "severity" | "starts_at">>(
  notices: readonly T[]
): T[] {
  return [...notices].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
  );
}

/**
 * How a notice's window reads to a patron: "until 4:00 PM", "since 2:15 PM".
 *
 * **Never "for 2 hours".** A duration implies someone knows when it ends, and
 * for the case this feature was built around — a contamination — nobody does.
 * A notice with no `ends_at` says when it started and nothing else, which is
 * the honest sentence.
 *
 * Local clock throughout, like every other time in this app since migration
 * 036 removed the stored timezone.
 */
export function describeNoticeWindow(
  notice: Pick<FacilityNotice, "starts_at" | "ends_at">,
  now: Date = new Date()
): string {
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  const starts = new Date(notice.starts_at);
  const sameDay = starts.toDateString() === now.toDateString();

  if (notice.ends_at) {
    const ends = new Date(notice.ends_at);
    return ends.toDateString() === now.toDateString()
      ? `Until ${time(notice.ends_at)}`
      : `Until ${day(notice.ends_at)}, ${time(notice.ends_at)}`;
  }

  return sameDay
    ? `Since ${time(notice.starts_at)}`
    : `Since ${day(notice.starts_at)}, ${time(notice.starts_at)}`;
}
