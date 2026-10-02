# Prompt: The Facilities page, map first

Copy everything below the line into a fresh Claude Code session run from `C:\ForRec\dropin`.
**Review first, then build.** Deliver Phase 1 and stop for approval before changing code.

---

## The goal

`/dashboard/facilities` is a grid of cards today (`src/app/(dashboard)/dashboard/facilities/page.tsx`,
`src/components/facilities/FacilityGridCard.tsx`). Replace it with a **map-first page**: a Mapbox map
fills the main area and shows every facility where it actually is; a list of facilities sits in a
panel on the right. Selecting a facility in either place selects it in both.

The design is the "Facilities: on the map" row of the Dropin design canvas (artboards
`Facilities.dc.html` desktop 1440×900 and `FacilitiesPhone.dc.html` 390×844). PJ can share it;
its rules are written out below so you don't need it to start.

## Read this history first — this reverses an earlier decision, deliberately

Mapbox was **removed** in `ef0a035` ("narrow Dropin from a marketplace to a tool for one centre"):
see the comment above the grid in `facilities/page.tsx`, the header of
`supabase/migrations/052_facility_directory_listing.sql`, `src/lib/geo/geocode.ts`, and the note in
`src/lib/security/csp.ts`. The reasons were a paid dependency and its token, geocoding on every
save, a bad geocoder ("123 Test St, Calgary" placed near Saskatchewan) and extra CSP origins.

The product owner now wants the map back **for display**. Keep what was fixed:

- **Geocoding stays on Nominatim** (`src/lib/geo/geocode.ts`, called from `POST/PATCH
  /api/facilities…` only when the address changes, `geocoded_at` recording the attempt). Do **not**
  geocode with Mapbox — its standard geocoding results may not be stored, and we store `lat`/`lng`.
  Mapbox is used for map tiles and the GL renderer only.
- The `location` geography column follows `lat`/`lng` by trigger (052). Nothing changes there.
- Update the comments that say Mapbox is gone (page, `csp.ts`, `geocode.ts` if it says so) so the
  code tells the truth afterwards.

## The design

### Desktop (≥1024px)

- **Layout:** sidebar | map (fills the rest, full height under the top bar, no page padding) |
  right panel **380px**, `background` fill, 1px `border` on its left.
- **Right panel, top:** "Facilities" (page title role) with the one ink `default` button,
  **Add facility**, on the same row; a search field under it (filters by name or city, and the
  map's pins with it). Then the list. A footer line in caption text: "3 facilities · 1 off this
  map" (the second half only when true).
- **List row** (a real `<button>`, full width, 14–16px padding, hairline between rows): a 28px
  round mark (the facility's photo/logo — `photo_urls[0]` — cropped round, else its initial on
  ink), name (14/600), city and province in caption, "2 departments · 1 schedule" in caption, and
  the published state as a `Badge` (`success` "Published", `default` "Draft"). Selected row:
  `bg-brand-subtle`, name in `text-brand-strong`, mark in `brand`.
- **Pins:** an HTML marker per facility with coordinates — a 36px teardrop in ink with a building
  icon (or the round logo) and a white 3px ring, and the short name in a pill label under it.
  Selected pin: `brand` fill. Pins are `<button>`s with `aria-label` = the facility name.
- **Selected facility card,** floating top-left over the map, 300px, `card` fill, 16px radius:
  name, city, the published badge and the counts badge, and three buttons — **Schedule**
  (`commandCentreHref({facilityId})`), **Post a status** (`/dashboard/facilities/{id}/status`),
  **Edit** (ghost, the edit page). A close button clears the selection.
- **Map controls,** top-right, in a white rounded group: zoom in, zoom out; below it a separate
  **Show all** button. Mapbox's own attribution stays (required) — style it quietly, don't hide it.
- **Selection sync:** click a pin → select its row and scroll it into view; click a row → select
  the pin and `easeTo` it (respect `prefers-reduced-motion`: jump, don't fly). Hovering a row
  raises its pin.

### Phone (<1024px)

- Map on top (~45% of the viewport), the list beneath it in a sheet with a grab handle that
  overlaps the map's bottom edge by 16px. "Add" stays in the top bar. Tapping a pin selects and
  scrolls to its row; tapping a row selects and centres its pin. Rows are ≥64px tall. No floating
  card on a phone — the selected row carries the actions (Schedule / Post a status / Edit) when
  expanded.

### The "far away" rule (real data needs this)

The org has two buildings on the Saanich Peninsula and a test centre in Edmonton. Fitting all three
would zoom out to half of Western Canada and merge the two real pins. So:

- **Initial view** fits the bounds of the **main cluster**: facilities within ~150 km of the
  median facility (put the threshold in one named constant). Padding so pins clear the card and
  the controls.
- Facilities outside it get an **off-map chip** on the map's bottom-right ("Test Rec Centre ·
  Edmonton, AB →") and "· off this map" on their list row. Clicking either flies there and selects
  it. **Show all** fits everything, explicitly.
- One facility: centre on it at a street-level zoom. None with coordinates: the list fills the page
  and the map area shows a short empty state ("Add an address to a facility to see it on the map").

### Facilities without coordinates

Two cases, and the copy says which (052's convention): `lat` null and `geocoded_at` null → "No
location yet"; `lat` null and `geocoded_at` set → "Address not found — check it". Both appear in
the list with a dashed muted mark and **no pin**, and their row links to the edit page's address
fields.

### Look and feel

- `docs/DESIGN.md` is binding: tokens only (no raw palette classes or hexes outside the map style),
  one ink button per view (Add facility), pills for buttons, Geist, hairlines not shadows except the
  card shadow on the floating card and controls, light **and** dark.
- **Map style:** Mapbox `light-v11` in light mode and `dark-v11` in dark, switched when the theme
  changes. If a custom style is cleaner (water close to `brand-subtle`, land close to `muted`),
  propose it in the review rather than building it first.
- Keep the old grid's information — nothing a card showed today may disappear (published state,
  city, department and schedule counts, Post a status, Edit).

## Engineering requirements

- **Dependency:** `mapbox-gl` (check the current major and its license terms in the review). Load it
  **only on this page** via `next/dynamic` with `ssr: false`; the rest of the dashboard must not pay
  for it. Import its CSS only there.
- **Token:** `NEXT_PUBLIC_MAPBOX_TOKEN`, a **public, URL-restricted** token (document in
  `.env.example` and `docs/DEPLOYMENT.md` how to restrict it to the production and preview origins).
  **No token → the page still works:** right panel becomes the full-width list (or keep the current
  grid), with no broken map box. Never crash on a missing token.
- **CSP (`src/lib/security/csp.ts`):** add exactly what mapbox-gl needs — `api.mapbox.com`,
  `*.tiles.mapbox.com`, `events.mapbox.com` in `connect-src`; tiles/sprites in `img-src` as needed;
  `worker-src blob:` / `child-src blob:` for its worker. Explain each addition in the comment, and
  verify in the browser console that nothing is blocked.
- **Data:** the page already reads facilities server-side; add `lat`, `lng`, `geocoded_at`,
  `photo_urls`, `city`, `province`, `is_published` and the department/schedule counts it already
  computes. Pass plain data to one client component; no client fetch for the list.
- **Roles:** same visibility as today (`canReadFacility` for scoped roles). Add facility only for
  `facility:create`. Aux staff never reach this page (it is a management page).
- **Accessibility:** the list is the accessible equivalent of the map — everything the map does is
  doable from the list with a keyboard. Pins are focusable buttons; the map canvas has an
  `aria-label`; Escape closes the card. Text 4.5:1 on its ground, including pin labels over tiles
  (hence the solid pill behind them).
- **Performance:** markers are DOM elements, fine at this scale; if an org ever has 50+, cluster.
  Mention it, don't build it.

## Phase 1 — review (deliver this, then stop)

1. What the current page, `FacilityGridCard`, the facility routes and `geocode.ts` do today, and
   what each facility in the dev database has for `lat`/`lng`/`geocoded_at` (run
   `scripts/backfill-facility-geocodes.mjs --dry-run` or equivalent if it exists).
2. The component plan: files, props, where state lives, how selection syncs, how dark mode reaches
   the map style.
3. The exact CSP diff and dependency/version, with the license note.
4. The no-token and no-coordinates behaviour.
5. Risks and anything in this brief you disagree with.

## Phase 2 — build (after approval)

Small steps, each ending green: `tsc --noEmit`, `eslint` on touched files, existing
`scripts/verify/*` harnesses that touch facilities, and `docs/DESIGN.md` §10 — screenshots at 1440px
and 390px in light and dark, before and after, with the console free of CSP errors.

## Out of scope

- Public pages (`/find`, the facility page, the widget). This is the dashboard only.
- Changing the geocoder, or geocoding on the client.
- Drawing facility floorplans on the map (that is `/dashboard/map`, a different feature).
