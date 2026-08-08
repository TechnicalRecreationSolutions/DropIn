# `/org/[orgSlug]` — the public organization surface

The app's first public route that addresses an **organization** rather than a
building or the platform's own directory.

```
/org/[orgSlug]            landing — event calendar card + the org's locations
/org/[orgSlug]/events     the org-wide "What's Happening" month calendar
/org/[orgSlug]/brochure/[seasonSlug]    ← Phase D, not built
```

## Why it exists

`(public)` could previously only say `/facility/[slug]`. An org running a pool,
an arena, and a community hall had no URL that meant *the organization*, and the
event calendar is org-wide by definition — the printed sheet on the wall lists
what's happening across every building. There was nowhere to put it.

## Route decisions

**Not in `PublicNav`.** That nav is platform wayfinding ("Find Activities",
"Browse Sports") and is identical on every public page. An org-specific
destination there is either dead weight for every visitor not looking at that
org, or a nav that changes shape per route. Orgs are reached from their facility
pages (the "What's happening" card in the sidebar) and from links orgs publish
themselves.

**`/org/[orgSlug]` is a real page, not a redirect to `/events`.** It started as
a redirect and that failed the build: `redirect()` on an awaited param is
runtime control flow, which Cache Components cannot prerender. It's the better
answer regardless — truncating a printed URL back to the org should land
somewhere, not bounce.

**The events page is not gated on `widget_configs.allowed_templates`.** That
setting governs which layouts the *widget's* switcher offers. This URL is the
event calendar specifically, so there is no layout to choose and nothing to
gate; an org with no events sees the calendar's own empty state. Gating would
404 a page that starts working the moment someone flips a toggle.

**No view switcher.** The facility page and widget offer whichever layouts the
org enabled, because they are *the schedule*. This URL is one specific artifact.
A toggle that turned it into a weekly grid of every session in every building
would be a different page at the same address.

## Prerendering: the trap

Cache Components is enabled. **The layout must not `await params`.**

A layout sits *above* the Suspense boundary that `loading.tsx` creates for the
pages beneath it, so awaiting request data in the layout blocks the entire
segment from prerendering a static shell — and under Cache Components that is a
hard build failure, not a slow route. The layout therefore passes the `params`
promise down into a Suspense-wrapped `<OrgMasthead>` and never awaits it itself.
That is also why it uses the generated `LayoutProps<"/org/[orgSlug]">` helper
rather than a hand-written interface: layouts are validated against it, unlike
pages.

`loading.tsx` covers this segment and everything nested under it, which is what
lets the pages await `params` freely. It renders only the page body — the layout
supplies the container and its own masthead fallback.

## Data

`orgPublicData.ts` holds the cached reads:

| Function | Used by | Why separate |
|---|---|---|
| `getOrgPublicData` | layout, both pages, `generateMetadata` | One cache entry across all of them — the org lookup costs one query set per render, not four |
| `getOrgFacilities` | the landing page only | A cached function is cached whole; merging it would make the events page pay for a list it never reads |

Both read **`organizations_public`**, never `organizations`. The base table is
members-only (migration 026) because it carries contact and billing columns and
RLS cannot restrict columns; the view is the world-readable projection and only
exposes active orgs.

Event data is client-fetched by `OrgEventsClient` through the shared
`useTemplateSchedule` pipeline, under the same query key as every other schedule
surface. It mounts the same `ScheduleView` the widget and dashboard mount, with
no editing provider above it — read-only by construction rather than by a second
component that could drift.

## Known issue, shared with `/facility/[slug]`

A nonexistent slug returns **HTTP 200 with a 404 body**. The static shell is
committed before the cached lookup resolves, so `notFound()` can no longer set
the status. This is pre-existing behaviour of the streaming setup, identical on
the facility route, and is a soft-404 for crawlers. Fixing it means either
`generateStaticParams` or moving the existence check ahead of the shell — a
decision that should be made once, for both routes.
