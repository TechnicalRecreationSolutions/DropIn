# Prompt: Remove Seasons, Events, and Brochures

Copy everything below the line into a fresh Claude Code session run from `C:\ForRec\dropin`.

---

## The mission

Fully remove the **seasons → events → storage → brochure** track from Dropin: the events calendar, the seasonal brochure editor/viewer, and season management. This is a deliberate scope cut, not a pause — treat it exactly like the earlier scraping removal (`supabase/migrations/021_remove_scraping.sql`), which is your template for how a fully-built feature gets torn out cleanly rather than left half-alive. Do not offer to resume any part of this afterward; if a future session asks, the answer is "removed on purpose, see `docs/PLAN.md`."

## Why this is happening

The track was built across phases A–D (`docs/RESUME-events.md`) under an earlier, broader product vision. Dropin has since narrowed twice — first to a single-organization tool, not a multi-org marketplace, then again to cut scope aggressively toward launch (`docs/PLAN.md` has both decisions). Seasons/events/brochure survived the first narrowing because it was arguably still in-scope for "one centre publishing its own schedule." It does not survive the second: it's an eighth-plus staff surface (dashboard pages, a command-centre tab, a whole public org route, a print pipeline) for a feature nobody asked to keep. Cut it.

## Read first

- `docs/RESUME-events.md` — what this track is and the state it shipped in.
- `docs/prompts/seasons-events-brochure.md` — the original build brief, useful for understanding intent behind anything ambiguous.
- `docs/PLAN.md` §3a — the schema summary and phase table for this track.
- `supabase/rollbacks/027_seasons.sql` through `032_brochure_entry_source_shape.sql` — written as the removal template for each migration in this track. Read every one before writing the removal migration; several have sharp edges called out below.

## The inventory (verified against the live repo, not reconstructed from memory)

### Database — migrations `027`–`032`

| Migration | What it added |
|---|---|
| `027_seasons.sql` | `seasons` table + `sessions.season_id` |
| `028_session_features.sql` | `sessions.is_event`, `sessions.in_brochure` + `session_features` table |
| `029_widget_config_events_template.sql` | `'events'` added to `widget_configs.allowed_templates` CHECK |
| `030_storage_org_media.sql` | `org-media` Storage bucket + RLS helpers (**shared bucket** — see constraints) |
| `031_brochures.sql` | `schedule_groups.in_brochure` + `brochures`, `brochure_sections`, `brochure_entries` tables |
| `032_brochure_entry_source_shape.sql` | CHECK-constraint bugfix on `brochure_entries`, purely brochure-internal |

Tables to drop: `brochure_entries`, `brochure_sections`, `brochures`, `session_features`, `seasons` (drop in that dependency order).
Columns to drop: `sessions.season_id`, `sessions.is_event`, `sessions.in_brochure`, `schedule_groups.in_brochure`.

### App layer

- **Whole files/directories to delete:**
  `src/app/(dashboard)/dashboard/seasons/`, `src/app/(dashboard)/dashboard/brochures/`, `src/app/(public)/org/[orgSlug]/events/`, `src/app/(public)/org/[orgSlug]/brochure/`, `src/components/seasons/`, `src/components/brochure/`, `src/components/schedule/EventCalendarView.tsx`, `src/components/schedule-command/SeasonPicker.tsx`, `src/components/schedule-command/EventsPanel.tsx`, `src/components/schedule/editing/FeatureSessionDialog.tsx`, `src/app/api/seasons/`, `src/app/api/brochures/`, `src/app/api/sessions/features/`, `src/app/api/sessions/events/`, `src/lib/seasons/current.ts`, `src/lib/brochure/candidates.ts`.

- **Mixed files — surgical edits, not deletions** (each has unrelated logic used by ordinary, non-event scheduling that must survive):
  `src/components/schedule-command/ScheduleCommandCentre.tsx`, `WorkspaceTabs.tsx` (drop the "Events" tab), `src/components/schedule-editor/SessionForm.tsx` (drop the "Feature this session" section), `src/components/schedule/editing/CreateSessionDialog.tsx`, `SessionActionsMenu.tsx` (drop the feature/event-calendar menu items), `ScheduleEditingContext.tsx` (drop `onToggleEvent`/`onFeature`), `src/components/schedule/ScheduleView.tsx` (drop only the `"events"` switch case), `src/components/widget/WidgetConfigurator.tsx` (drop the `"events"` template option + its `/api/sessions/events` check), `src/app/widget/[orgId]/WidgetScheduleClient.tsx`, `src/app/(public)/facility/[facilitySlug]/FacilityScheduleClient.tsx` (drop `view === "events"` special-casing), `src/app/api/sessions/route.ts` (drop `season_id` handling), `src/app/api/sessions/expand/route.ts` (drop `seasonId`/`eventsOnly` + the `session_features` join), `src/lib/rrule/expand.ts` (drop only the block mapping `seasonId`/`isEvent`/`inBrochure`/`linkUrl`/`linkLabel`/`eventCategory`/`accentColor` onto `ExpandedSession` — **its unrelated local variables named `seasonStart`/`seasonEnd` are a pre-existing session date-window concept, not the `seasons` table; do not touch them**), `src/lib/storage/orgMedia.ts` (drop `"events"`/`"brochure"` from `OrgMediaKind`, keep the rest), `src/lib/schedule/commandCentreHref.ts` (drop `"events"` from `WorkspaceTab`), `src/app/globals.css` (drop the `.event-calendar` and `.brochure*` `@media print` blocks).

- **Types to trim, not delete wholesale:** `src/types/database.types.ts` (remove the five tables/columns above; leave `stripe_events` and `analytics_events` alone — name collision only), `src/types/schedule.types.ts` (remove `"events"` from `ScheduleTemplate`, the event/brochure fields on `ExpandedSession`, `eventDisplayTitle()`, `seasonId`/`eventsOnly` on `ScheduleFetchScope`).

- **Navigation to clean up:** `src/components/layout/TreeNavContent.tsx` (drop the `/dashboard/seasons` and `/dashboard/brochures` entries).

### Decision point — don't auto-resolve, decide deliberately

`src/app/(public)/org/[orgSlug]/` (`layout.tsx`, `page.tsx`, `loading.tsx`, `orgPublicData.ts`) was built almost entirely as a landing point for the event calendar — its own page content is little more than a facility list plus an "Event calendar" card. Once events/brochure are gone, decide whether this route still earns its place as a thin multi-facility org index, or whether it should go too. Either way:
- `src/app/(public)/facility/[facilitySlug]/page.tsx` links into it (a breadcrumb to `/org/[slug]` and an "org-wide events" card) — update or remove those links to match your decision.
- If you keep the org route, strip the events card and the brochure link from it; don't leave dead links pointing at routes you just deleted.

### Explicitly out of scope — do not touch

These live in the same tables/files as this track but belong to unrelated features:
- `schedule_groups.status`, `.starts_on`, `.ends_on` (migration `033`) — core publish/date infrastructure used everywhere, not brochure-specific, even though brochure candidacy reads them.
- `schedule_groups.published_at` + the two session-write triggers (migration `035`) — belongs to the schedule-list-view MODIFIED-status feature (`docs/RESUME-schedule-list-view.md`). Brochures have their own separate `published_at` on the `brochures` table; that one goes, this one does not.
- The `org-media` Storage bucket itself, its RLS helper functions, and the `facilities/`, `schedules/`, `org/` folder kinds — shared with facility photos, schedule-group photos, and the org logo. Only remove the `events`/`brochure` kind values and their policy branch; don't drop the bucket.
- `src/components/media/ImageUpload.tsx`, `OrgImage.tsx` — generic upload components reused by unrelated features.
- `src/lib/seo/notFoundMetadata.ts` — generic 404 helper shared by all public routes.
- `src/lib/utils/dates.ts` — generic date formatting, not part of this track.
- `scripts/verify/verify-e.mjs` through `verify-h.mjs` (facility delete/org settings, recurrence/conflict, publish gate, modified-tracking) — unrelated, must still pass after this work.

## Scope of work

### A. Database migration

Write `supabase/migrations/036_remove_events_brochure_seasons.sql`, following `021_remove_scraping.sql`'s defensive style (`IF EXISTS`/`IF NOT EXISTS` — never assume a database's exact migration history). Before dropping the `widget_configs.allowed_templates` CHECK back down to `grid`/`list`/`map`/`floorplan`, first run the defensive cleanup `029`'s own rollback calls out: clear `'events'` from any row's `allowed_templates` and backfill any row left with an empty array. Never touch migrations `001`–`035` directly — this is a new, additive-only removal migration. Write a matching rollback under `supabase/rollbacks/` only if you have a real reason to keep the door open; otherwise note in the migration header that this removal is intentionally final, same as `021`'s framing.

Handle the Storage side separately from the schema: delete objects under the `events/` and `brochure/` path prefixes in the `org-media` bucket, and trim `org_media_kind()` to stop accepting those two kinds — but leave the bucket and the `facilities`/`schedules`/`org` kinds untouched.

Per this project's standing process, you write the migration; the user applies it by hand via the Supabase SQL editor. Don't attempt to run it yourself.

### B. App-layer removal

Delete the whole-file list above. Surgically edit every file in the mixed-file list — grep each one for `brochure`/`season`/`is_event`/`in_brochure`/`EventCalendar` afterward to confirm nothing was missed. Resolve the org-route decision point and update the facility page's links to match.

### C. Types, lib, navigation

Trim `database.types.ts` and `schedule.types.ts` as scoped above. Update `orgMedia.ts` and `commandCentreHref.ts`. Remove the two dead sidebar entries from `TreeNavContent.tsx`.

### D. Docs

- Retire `docs/RESUME-events.md` and `docs/prompts/seasons-events-brochure.md` — keep them (like the scraping removal's history in `docs/PLAN.md` §1) rather than deleting, but mark clearly at the top that the feature was removed and why, with a pointer to this prompt and the removal migration.
- Update `docs/PLAN.md` §3a to reflect removal, matching how it documents the scraping removal.
- Fix `docs/RESUME.md`'s stale pointer at `RESUME-events.md`.
- Delete or gut `src/components/seasons/README.md` and `src/components/brochure/README.md` (directories are gone). Trim the storage-kind rows out of `src/components/media/README.md`, the "Printing"/"Featuring"/"Adding from a month cell" sections out of `src/components/schedule/README.md`, and any org-route content in `src/app/(public)/org/[orgSlug]/README.md` per your routing decision.
- Check `docs/SECURITY.md` for the Storage section/standing-assumptions added alongside this track and update if it references events/brochure specifically.

### E. Verification scripts

`scripts/verify/verify-b.mjs`, `verify-c.mjs`, `verify-d.mjs` test this track's phases B/C/D and will fail once it's gone — remove them (or archive under a clearly-labeled retired path if this project's convention prefers keeping a record; check `scripts/verify/README.md` for precedent). Re-run every remaining verify script (`verify-e` onward) to confirm nothing outside this track broke.

## Constraints

- Never edit an already-run migration (`001`–`035`) — removal is a new migration only, following `021`'s defensive `IF EXISTS` pattern.
- Don't touch anything in the "explicitly out of scope" list above without re-reading why it's there first — several of these are name collisions or shared infrastructure that look related but aren't.
- Mobile-first behavior must not regress for anything you touch, per this project's standing convention.
- Keep every non-trivial directory's README current, per this project's standing convention.
- Commit in reviewable chunks (schema, whole-file deletions, mixed-file edits, nav/types, docs) rather than one giant commit.

## Definition of done

- Repo-wide grep for `brochure`, `season`, `EventCalendar`, `is_event`, `in_brochure` returns only: the removal migration and its comments, the two retired/marked docs, and confirmed name collisions (`stripe_events`, `analytics_events`, generic DOM/analytics "event" usage). Nothing live references the removed feature.
- `npx tsc --noEmit`, `npx eslint`, `npx next build` all clean.
- No dangling UI: sidebar has no Seasons/Brochures entries, command centre has no Events tab, widget configurator offers no events template, facility page has no broken "org-wide events" link.
- `verify-e.mjs` through the newest verify script still pass unmodified.
- A live browser pass through the dashboard sidebar, command centre, a public facility page, and (if kept) the org route — confirming no 404s, no broken links, no console errors — not just green types.
