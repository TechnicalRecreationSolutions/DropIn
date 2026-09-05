import type { SessionFilterKey } from "@/lib/schedule/sessionFilters";
import type { ScheduleTemplate } from "@/types/schedule.types";

export type WidgetTheme = "light" | "dark";

/**
 * How step 4 hands the schedule over to the customer's website.
 *
 * All three point at the same `/widget/[orgId]` page and the same published
 * settings — they differ only in what the site is able to accept:
 *
 * - `script`  the loader in `public/embed/widget.js`. Builds the iframe itself
 *             and grows it to fit via the `dropin:resize` message, so the
 *             schedule never sits in a box with its own scrollbar. Default.
 * - `iframe`  the same page, hand-written. Fixed height — nothing is listening
 *             for the resize message — but it survives the many municipal and
 *             school CMSes that strip `<script>` out of a content block.
 * - `link`    no embedding at all: send visitors to the hosted page. The last
 *             resort for sites that block iframes too, and the thing to paste
 *             into a nav menu or a button.
 */
export type EmbedMethod = "script" | "iframe" | "link";

/** A facility as the studio needs it: name for the pickers, slug/publish state for the share link. */
export interface WidgetFacility {
  id: string;
  name: string;
  slug: string | null;
  isPublished: boolean;
}

/**
 * One row of the "let visitors filter between schedules" editor, before save.
 *
 * `key` is the React key and is *not* the database id for unsaved rows — new
 * rows get a local `new-N` key and only pick up a real `widget_config_scopes`
 * id once the server round-trips them back.
 */
export interface LocalScope {
  key: string;
  label: string;
  facilityId: string;
  departmentId: string;
  scheduleGroupId: string;
}

/** The shape `/api/widget-config` returns for a saved filter row. */
export interface SavedScope {
  id: string;
  label: string;
  facility_id: string;
  department_id: string | null;
  schedule_group_id: string | null;
}

export function savedScopeToLocal(s: SavedScope): LocalScope {
  return {
    key: s.id,
    label: s.label,
    facilityId: s.facility_id,
    departmentId: s.department_id ?? "",
    scheduleGroupId: s.schedule_group_id ?? "",
  };
}

/**
 * The settings that live in `widget_configs` / `widget_config_scopes` — i.e.
 * everything the Publish button writes, and everything that changes the org's
 * public schedule page as well as the embed.
 *
 * Deliberately excludes theme and height: those are *snippet* options that only
 * exist in the `<script>` tag on the customer's own site. Keeping the two sets
 * apart in the type is what keeps them apart in the UI — the old single-card
 * layout mixed them and produced a steady stream of "I changed it and nothing
 * happened" confusion.
 */
export interface PublishedSettings {
  allowedTemplates: ScheduleTemplate[];
  primaryColor: string;
  customTitle: string;
  /** Which general filters visitors get — `widget_configs.enabled_filters` (migration 044). */
  enabledFilters: SessionFilterKey[];
  scopes: LocalScope[];
}

/** Stable string form of the persisted settings, for dirty-checking against the last save. */
export function publishedSignature(s: PublishedSettings): string {
  return JSON.stringify({
    templates: s.allowedTemplates,
    primary: s.primaryColor.toUpperCase(),
    title: s.customTitle.trim(),
    // Order is not meaningful here (unlike allowed_templates, whose first
    // entry is the default view), so a re-ordered but identical set must not
    // read as an unsaved change.
    filters: [...s.enabledFilters].sort(),
    // Rows without a facility are dropped on save, so they must not count as
    // an unsaved change either — otherwise clicking "Add a filter" and walking
    // away leaves a publish bar that never goes away.
    scopes: s.scopes
      .filter((r) => !!r.facilityId)
      .map((r) => [r.label.trim(), r.facilityId, r.departmentId, r.scheduleGroupId]),
  });
}

export type { ScheduleTemplate };
