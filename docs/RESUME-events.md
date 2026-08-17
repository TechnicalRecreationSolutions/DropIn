# Resume here — Seasons / Events / Brochure track

> **REMOVED 2026-08-16.** This entire track — seasons, the event calendar, and
> the seasonal brochure — was torn out on purpose, the same way scraping was
> (`supabase/migrations/021_remove_scraping.sql`). Dropin narrowed twice after
> this track shipped: first to a single-organization tool, then again to cut
> scope aggressively toward launch. It is not paused and there is nothing here
> to resume. See `docs/prompts/remove-events-brochure.md` (the removal brief)
> and `supabase/migrations/036_remove_events_brochure_seasons.sql` (the removal
> migration) and `docs/PLAN.md` §3a. If a future session asks whether to bring
> this back, the answer is no — everything below is historical record only.

---

Last session ended **2026-08-09**. Working tree **clean**, `main` **level with
`origin/main`**, everything committed and pushed.

Full design brief: [`docs/prompts/seasons-events-brochure.md`](prompts/seasons-events-brochure.md).
Phase table: [`docs/PLAN.md` §3a](PLAN.md).

---

## The one thing to do first

**Nothing is blocking.** No migrations are pending, nothing is half-applied, the
app builds and runs.

The one outstanding gap is that **none of this track's UI has been opened in a
browser.** Four sessions of interface — the events calendar, the Events tab, the
feature dialogs, the brochure editor, the published brochure, and *both* print
stylesheets — are verified only at the data and route layer. See
[What is and isn't verified](#what-is-and-isnt-verified).

If you can get the Chrome extension connected, do that before starting Phase E.
The print output in particular is the deliverable the brief cares most about and
has no automated coverage at all.

---

## Where the track stands

| Phase | State |
|---|---|
| **A — Seasons** | ✅ Shipped. `027` applied. |
| **B — Event calendar** | ✅ Shipped. `028`, `029` applied. All five gaps against the brief closed. |
| **C — Storage + uploads** | ✅ Shipped. `030` applied. |
| **D — Brochure** | ✅ Shipped. `031`, `032` applied. |
| **E — Control centre** | ⬜ Not started. The last phase. |

Migrations `027`–`032` are **all applied to the hosted database** and verified
against it.

Commits, newest first:

```
687f948  brochure: editor, public route, print output
f579d84  brochure: schema, candidacy, schedule-group flag
fded82c  storage: the org-media bucket and every image field
c01aa27  events: add-on-a-day, defaulting to a one-off
2c5e810  events: the org-wide Events workspace tab
198b775  events: SessionForm toggles + one-click event action
c922cdf  seasons + the event calendar + the public org surface
```

---

## What is and isn't verified

### Verified — 123 assertions, 0 failures

The harnesses now live in the repo at
[`scripts/verify/`](../scripts/verify/README.md) (they used to be throwaway
scratchpad scripts; they were moved because three phases depend on them). Run
them against a running dev server:

```bash
npm run dev
node scripts/verify/verify-b.mjs   # 64
node scripts/verify/verify-c.mjs   # 19
node scripts/verify/verify-d.mjs   # 40
```

Each builds a throwaway org, drives the real HTTP routes as a genuinely
signed-in user over `@supabase/ssr` cookies, and tears everything down in a
`finally`. Read that directory's README before adding to them — it records the
four rules that stop these producing false green results.

### Not verified — anything visual

The Chrome extension is not connected (`list_connected_browsers` returns `[]` —
the extension must be signed into claude.ai with the *same* account as Claude
Code, and Chrome restarted after install). Outstanding:

1. The month event calendar, its hover `+`, and the mobile agenda.
2. **Print preview of the event calendar** — one landscape page, no chrome, org
   masthead, chip colours intact, and *only one calendar* (the schedule panel
   stays mounted-but-hidden behind the Events tab; the rules say it can't print,
   but nobody has looked).
3. The `⋯ → Add to event calendar` one-click action and the Feature dialog.
4. `SessionForm`'s "Feature this session" disclosure, including that it does
   **not** rewrite the recurrence on an existing session.
5. The brochure editor: pulling, dragging between sections, the Removed tray.
6. **Print preview of a published brochure** — multi-page portrait, headings not
   stranded at page feet, entries not split, URLs printed beside link labels.
7. Image upload actually picking, uploading and previewing a file.

Everything behind all seven is proven. What is unproven is React and CSS.

---

## Phase E, when you start it

Season **milestones** and **tasks**, plus derived readiness signals. The brief's
§ "Layer 3" has the schema. Two things it insists on, and both are the point:

- **Derived readiness, not just checkboxes** — "12 of 15 schedule groups have
  sessions inside Fall 2026", "4 featured events have no image", "the Fall
  brochure has 0 entries and prints in 11 days". These all now compute from
  tables that exist. Put every one in `src/lib/seasons/readiness.ts` so the
  dashboard, the control centre and any future digest share definitions.
- **Deep links into the work** — every signal links to the thing.
  `commandCentreHref()` for schedules, `/dashboard/brochures/[id]` for brochures.

Routing needs a deliberate decision: `/dashboard/schedule` is already called
"the command centre" internally and "Manage" in the nav. **Do not ship two
things both called a command centre.** The mobile bottom bar is at its four-item
limit; Seasons and Brochures were both deliberately left out of it.

Assignment notifications are **in-app only** — SMTP is still not configured.

---

## Decisions already made, so you don't relitigate them

**Seasons**
- The season picker sets creation defaults; it never filters the grid. Every
  pre-seasons session has `season_id NULL`, so filtering would blank an existing
  org's schedule the moment they made a season.

**Events**
- `is_event` and `in_brochure` are two flags over one payload
  (`session_features`). Turning a toggle off deliberately keeps the copy.
- A one-off is `FREQ=DAILY;COUNT=1`. `isOneTimeRRule` must be checked *before*
  `FREQ=DAILY` when parsing, or every one-off reads back as a daily series.
- One query key for all schedule fetches (`SCHEDULE_RANGE_KEY`).
- `useScheduleAnchor` holds **one date**; the week and month are both derived.
  You cannot store the week and derive the month —
  `getWeekStart(getMonthStart(october))` is Mon Sep 28.
- `useTemplateSchedule` picks the range from the template. A week's sessions in a
  month view looks fine and is empty after row one.
- The events calendar renders its own empty state *inside* the view, so an empty
  month is still one you can page out of. Callers must not short-circuit it.
- `/api/sessions/features` is a **PATCH**: absent means unchanged, `null` means
  clear. Do not "simplify" it — the one-click toggle sends only a flag, and under
  PUT semantics that single click erases every piece of copy on the session.
- The Events **tab** is org-wide; the Schedule tab's events **layout** is scoped.
  Different questions, which is why both exist.

**Storage**
- One public bucket, path-scoped `{orgId}/{kind}/…`. Objects are readable by
  anyone holding the URL — unguessability, not authorization. Nothing sensitive
  belongs there.
- SVG is excluded from `allowed_mime_types` deliberately; it is script-bearing
  and Storage sits on a host the CSP trusts for images.
- Writes are folder-scoped: `events`/`brochure` member-writable, everything else
  `org_can_manage()`.

**Brochure**
- Candidacy is computed, membership is stored, publication is frozen. Read the
  header of `031`.
- Dismissed entries are **tombstones**, never deletions. Deleting one would let
  the next pull resurrect what a human removed.
- Source FKs are `ON DELETE SET NULL`. `032` exists because `031`'s CHECK
  contradicted that and made a session in any brochure undeletable.
- **The public brochure page is deliberately not cached**, unlike every sibling
  public route. Its result depends on `status`; caching it meant unpublishing
  didn't take effect. See `src/components/brochure/README.md`.

**Cross-cutting**
- A layout under Cache Components must not `await params` — it sits above the
  Suspense boundary `loading.tsx` creates, and awaiting request data there fails
  the build.
- No print-only routes anywhere. A second rendering of the same content drifts.

---

## Known gaps and debt, all deliberate

| | |
|---|---|
| **No org settings page** | `organizations.logo_url` has a storage folder, a policy, and two render sites (the public org page, the printed event sheet) — but nothing sets it. There is no org settings surface in this app at all. |
| **Orphaned uploads** | Removing a *saved* image clears the field without deleting the object, because that URL may be on another record via "Duplicate to…". Replacing one *before* saving does delete the superseded file. A sweep is owed — best written once, now that Phase D added the fifth column referencing these URLs. |
| **No drag-sorting** | `@dnd-kit/sortable` is not a dependency. Dragging moves entries between brochure sections; arrows order within one. Also the better mobile call. Add the package if true drag-sorting is wanted. |
| **Soft-404s** | `/facility/[slug]`, `/org/[slug]`, its `/events` child and `/brochure/[slug]` return **HTTP 200 with a 404 body** — the streamed shell commits the status before the lookup resolves. **Investigated 2026-08-12 and the status cannot be fixed where it shows:** `notFound()` is already called correctly in each; the `loading.tsx` boundary above it is what commits the 200, and removing it does not merely lose prerendering — `next build` fails with "uncached or runtime data during prerendering", because these routes have no `generateStaticParams` so awaiting `params` is request data. Tried and reverted. The harm (crawlers indexing a dead page as real content) is now closed with `robots: noindex` via `lib/seo/notFoundMetadata.ts`; verified the four not-found responses carry it and the live pages do not. A real 404 needs `generateStaticParams` over published slugs, which buys a build-time database dependency. |
| **SMTP** | Still not configured. Still a launch blocker. Anything notification-shaped stays in-app. |

---

## Housekeeping

- Dev server was left running on `localhost:3000`.
- `tsc --noEmit`, `eslint src`, `next build` all clean.
- READMEs written this track: `components/seasons/`, `components/schedule/`,
  `components/media/`, `components/brochure/`, `app/(public)/org/[orgSlug]/`,
  `scripts/verify/`. Updated: `components/schedule-command/`.
- `docs/SECURITY.md` gained a Storage section and standing assumptions 24–26.
