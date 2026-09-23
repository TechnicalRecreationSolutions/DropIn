# Facility status

What is true at a facility **right now**, as opposed to what it plans to run.

```
staff → /dashboard/facilities/[id]/status ─► POST/PATCH /api/facilities/[id]/notices
                                                        │
                                                        ├─► facility_notices (migration 060)
                                                        └─► revalidateTag(facilityNoticesCacheTag(id))
                                                                     │
public ◄── /facility/[slug] ────┐                                    │
public ◄── /widget/[orgId] ─────┴── getPublicNotices() ◄─────────────┘
                                    "use cache", cacheLife("minutes")
staff  ◄── /dashboard (alert row), /dashboard/facilities (card footer)
```

| File | Job |
|---|---|
| `notices.ts` | The domain. The two axes and their labels, severity ranking, `isNoticeLive` and friends, and how a window reads in words. Client-safe. |
| `notice-presets.ts` | The catalogue that pre-fills a new notice. Vocabulary, not data. |
| `public-notices.ts` | The cached public read. Server only. |

## The model in one paragraph

A notice is a headline, a `category` (what happened) and a `severity` (how bad
it is for the patron), optionally narrowed to one space, live between
`starts_at` and `ends_at`, and published or not. It sits **above** the
schedule; nothing in the expansion pipeline reads it and it claims no spaces.
The full argument for each of those choices is in the header of
`supabase/migrations/060_facility_status.sql`, which is the document to read
before changing any of this.

## Four things that are easy to get wrong

**1. `ends_at` is the only lifecycle column.** Clearing a notice sets it to
`now()`. There is no `resolved_at`, no `is_active`, no status enum, and adding
one creates a row that can be resolved but not ended. "Clear" and "Delete" are
different acts and the UI says so: clearing keeps the record, deleting is for a
notice that should never have existed.

**2. The public read policy depends on `NOW()`, so a notice can stop being
public with no write.** A tag expiry cannot cover that — no write, no expiry —
which is why `getPublicNotices` is `cacheLife("minutes")` and must stay short.
It is a *separate* cache entry from the facility page's body, which is
`cacheLife("hours")`; joining them would either re-query an address every
minute or hide a contamination for an hour.

**3. Who may post is not a role question alone.** `organizations.
aux_can_post_notices` decides whether an aux staffer can, and each organization
answers for itself. Ask `canWriteNotice()` in `@/lib/auth/roles`, never
`can(actor, "notice:write")` on its own — the latter answers the role half and
would hand every aux staffer the button. In a route handler that is
`requireNoticeWrite()`; `public.can_write_notice()` in the database is the
actual control.

**4. The widget has no `.dark` class.** `NoticeBanner` renders on the public
facility page *and* inside the embed, which is an iframe on somebody else's
site — `dark:` utilities never fire there and neutral tokens resolve to their
light values. Hence the `variant` prop. Adding a `dark:` utility to that file
re-introduces the bug on the surface least likely to be checked.

## Scope

`space_id IS NULL` means the whole facility. In the embed, notices render only
when the widget resolves to one building (`dataFacility`) — an embed spanning
several has no single facility to speak for, and the visitor's client-side
scope switcher does not re-fetch them.

## Verifying

```bash
node --experimental-strip-types scripts/verify/verify-az.mjs --logic-only   # 16, no server
node --experimental-strip-types scripts/verify/verify-az.mjs                # needs 060 applied
```

Section 7 (the notice reaching the built page) is only meaningful against a
**production build** — `next dev` serves a cached segment for minutes whatever
`revalidateTag` does, so a red there is the dev server.

## Not built

- **Alerting.** Nothing emails, texts or pushes when a notice is posted.
- **A status badge on `/find`.** The directory card says nothing about today.
- **A draft/approve workflow.** `is_published = false` is a row state the UI
  exposes as "keep it internal", but nobody is asked to review it.
