# Facilities map (`/dashboard/facilities`)

The Facilities page, map first: a Mapbox map fills the page, the list sits in a
380 px panel on the right (≥1024 px) or in a sheet under the map (phones).
Brief: `docs/prompts/facilities-map.md`. Harness: `scripts/verify/verify-bm.mjs`.

## Files

| File | Role |
|---|---|
| `app/(dashboard)/dashboard/facilities/page.tsx` | Server. Reads facilities + live notices, narrows to `canReadFacility`, builds `FacilityMapItem[]`. **No token → the old grid** (`FacilityGridCard`). |
| `FacilitiesMapView.tsx` | Client. Owns all state: `selectedId`, `hoveredId`, the search. Layout, the floating card, controls, off-map chips, the theme and motion media queries. |
| `FacilityMapCanvas.tsx` | The only file that imports `mapbox-gl` (via `next/dynamic`, `ssr: false`). Map instance, markers (React portals), camera. Exposes `MapController` (`flyTo`, `fitMain`, `fitAll`, zoom). |
| `FacilityListRow.tsx` | One row — a real `<button>`, the accessible equivalent of its pin. Expanded on phones to carry the actions. |
| `FacilityActions.tsx` | Schedule / status line / Edit (+ the address link when unplaced). Used by the card and the expanded row. |
| `FacilityMark.tsx` | The 28 px round mark (photo, else initial; dashed when unplaced). |
| `types.ts` | `FacilityMapItem`, `locationState`, the copy for unplaced facilities. |
| `lib/geo/mainCluster.ts` | The "far away" rule: `MAIN_CLUSTER_RADIUS_KM`, `splitMainCluster`, `boundsOf`. Pure. |
| `components/facilities/FacilityStatusLink.tsx` | "Post a status" / "N statuses are live", shared with the grid card. |

## How selection syncs

State lives in `FacilitiesMapView`; the list and the pins only report clicks.

- **Pin click** → `selectedId` → the row scrolls into view (`block: "nearest"`).
- **Row click** → `selectedId` → `controller.flyTo(id)` (eases; jumps under
  `prefers-reduced-motion`).
- **Row hover/focus** → `hoveredId` → that pin is raised (`z-index`, scale).
- **Escape** clears the selection anywhere on the page.

The camera is moved by calls, not derived from props: "the user picked a row" is
an event, and a map re-fitting on every render would fight the user's own pans.

## Rules that are easy to break

- **The far-away rule.** The map opens on facilities within 150 km of the median
  one (densest group if the median falls between groups). The rest get an
  off-map chip and "· off this map" on their row. *Show all* fits everything.
- **Unplaced facilities** (`lat` null) have no pin. `geocoded_at` null → "No
  location yet"; set → "Address not found — check it". They still select and
  still get every action; their location line links to `edit#address_line1`.
- **Container sizing.** `mapbox-gl.css` sets `.mapboxgl-map { position:
  relative }`, which beats `absolute` on the same element and collapses the map
  to 0 px. The container is `size-full` inside an `absolute inset-0` wrapper.
- **No `key: undefined` in `new Map({...})`.** An explicit undefined `center`
  fails with "Invalid LngLat (NaN, NaN)". Spread the options instead.
- **Camera padding is to the pin's tip.** The pin rises ~45 px above it and the
  label hangs ~35 px below; the paddings in `FacilitiesMapView` account for the
  card, controls, chips and (on phones) the sheet's 16 px overlap.
- **Dark mode.** No theme library: the top bar toggles `.dark` on `<html>`; a
  `MutationObserver` hook feeds `dark` to the canvas, which calls `setStyle`
  (light-v11 ↔ dark-v11). Markers are DOM, so they survive the swap.
- **CSP.** The CSP build of mapbox-gl, worker served from
  `/mapbox-gl-csp-worker.js` (copied by `scripts/copy-mapbox-worker.mjs` on
  `predev`/`prebuild`, gitignored). `worker-src` stays `'self'`. See
  `lib/security/csp.ts`.
- **Failure.** WebGL missing, an init error, or a 401/403 from Mapbox (token
  not allowed on this origin) → `onFail` → the map area says so and the list
  carries everything. The reason is on `data-reason`.
- **Scale.** Markers are DOM elements — fine for a handful. At 50+ facilities,
  switch to a clustered symbol layer.
