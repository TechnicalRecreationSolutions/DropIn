# Public API (`/api/public/v1/…`)

Endpoints meant for callers outside this app: the `/find` page today, and the
planned native app later. Everything under `/api/public` is unauthenticated,
rate limited, and safe to cache publicly.

## Versioning

The path carries the version, and each response carries `apiVersion`. Within
`v1`:

- **Adding** a field is fine. Clients must ignore fields they don't know.
- **Renaming, removing or changing the meaning** of a field is a new version
  (`v2`), served alongside `v1` until nothing calls `v1`. An installed app can't
  be updated on our schedule.

The shapes live in `src/lib/directory/types.ts`, and `scripts/verify/verify-af.mjs`
asserts the exact key set, so an accidental rename fails a check.

## `GET /api/public/v1/directory`

The facilities residents can find: published, opted in with
`listed_in_directory` (migration 052), and owned by an active organization.

| Query | Meaning |
|---|---|
| `q` | Up to 80 characters. Every word must appear in the facility's name, city, province or organization name. Case and accents are ignored. |
| `sport` | A `SPORT_CATEGORIES` id (`src/lib/utils/sport-categories.ts`). Unknown ids return 400. |

```json
{
  "apiVersion": 1,
  "facilities": [
    {
      "id": "…",
      "slug": "saanich-commonwealth-pool",
      "name": "Saanich Commonwealth Pool",
      "description": null,
      "address": { "line1": "4636 Elk Lake Dr", "city": "Saanich", "province": "BC", "postalCode": "V8Z 5M1" },
      "location": { "lat": 48.50144, "lng": -123.38932 },
      "phone": null,
      "websiteUrl": null,
      "photoUrl": null,
      "organization": { "name": "…", "logoUrl": null },
      "sports": [{ "id": "swimming", "label": "Swimming" }],
      "path": "/facility/saanich-commonwealth-pool"
    }
  ],
  "attribution": "Locations © OpenStreetMap contributors"
}
```

- **No location parameter, on purpose.** Every listed facility is returned with
  its coordinates, and the caller sorts by distance (`sortByDistance` in
  `src/lib/directory/filter.ts`). A resident's position never reaches the
  server. This works for dozens of centres, not thousands: `MAX_LISTINGS` in
  `src/lib/directory/listings.ts` logs a warning when the ceiling is reached,
  and that's the signal to move search into PostGIS (`facilities.location` is
  already kept for it).
- **`location` is null** when the address couldn't be placed on the map. The
  facility is still listed.
- **`sports`** includes only schedules that are published and haven't ended.
- **`attribution`** must be shown wherever `location` is used (OpenStreetMap
  licence).
- **Caching:** the data is a shared server cache (`cacheLife("minutes")`, tag
  `directory`), and the response is `public, s-maxage=60`. A facility save or
  delete expires the server cache at once; the CDN copy can lag by up to a
  minute. A schedule being published or ending shows up within the cache's
  one-minute revalidation. `/find` reads the same entry and is a static page
  with a one-minute revalidate: a change made outside the app (for example, an
  organization deleted in the database) shows on the second request after a
  minute. This was checked on a production build; `next dev` can hold it for
  much longer, so don't judge freshness on the dev server.
- **Rate limit:** `directory` in `src/lib/rate-limit.ts`, 120 requests a minute
  per IP. Over the limit you get a 429 with `Retry-After`.
- **Errors:** `400 { error, details }` for bad input, `503 { error }` when the
  database read fails. A failed read is never cached as an empty directory.

## `GET /api/public/v1/facility/{facilityId}/conditions`

What is measurably true at a facility right now: water and air temperature, and
how busy it is (migration 061).

```json
{
  "apiVersion": 1,
  "readings": [
    {
      "spaceId": null,
      "spaceName": null,
      "metric": "headcount",
      "value": 42,
      "level": null,
      "recordedAt": "2026-09-22T21:15:00.000Z",
      "typicalValue": 35
    },
    {
      "spaceId": "…",
      "spaceName": "Lane pool",
      "metric": "water_temp_c",
      "value": 27.5,
      "level": null,
      "recordedAt": "2026-09-22T18:02:00.000Z",
      "typicalValue": null
    }
  ]
}
```

- **The projection happens in the database.** `facility_readings` has no public
  read policy at all; everything here comes from
  `facility_public_conditions()`, a SECURITY DEFINER function that applies the
  facility's own publishing choices. This route reshapes JSON and decides
  nothing.
- **`value` is `null` when `level` is set, and that is not a missing value.**
  A facility can publish a busyness band instead of a number
  (`facilities.public_headcount = 'level'`), and in that mode the exact count
  never leaves the function. `level` is one of `quiet`, `moderate`, `busy`,
  `full`.
- **`recordedAt` is never absent.** A number without its age is a claim about
  now that may be hours old; clients must show it.
- **`typicalValue`** is the mean for this weekday and hour over the preceding
  eight weeks, head counts only, and only with three or more samples. It is
  what a client falls back to once `recordedAt` has gone stale — a *different*
  sentence ("usually about 35 at this time"), not a caveat on the live one.
  Freshness windows are in `src/lib/conditions/readings.ts`: 90 minutes for a
  head count, 12 hours for a temperature. The function applies a blunt 24-hour
  floor underneath, so a client that forgets cannot publish yesterday.
- **An empty `readings` array is the normal case.** Most facilities publish
  none of this. It is also what an unpublished facility returns, whatever its
  settings say.
- **Caching:** `public, s-maxage=30`. The client polls at 60 s, so the cache
  mostly deduplicates visitors rather than delaying any of them. A failed read
  answers `503` with `no-store` — an empty conditions block must never be
  cached as "this pool has no temperature".
- **Rate limit:** `facilityConditions` in `src/lib/rate-limit.ts`, 120 requests
  a minute per IP. This is the one public endpoint a page polls, so a visitor
  with the schedule open all afternoon is a legitimate repeat caller; the
  component pauses while the tab is hidden.
- **Errors:** `400 { error }` for an id that is not a UUID, `503 { error }`
  when the read fails.

## Not yet versioned

A facility's schedule still comes from `/api/sessions/expand`, which is the
app's internal endpoint (its query parameters and response follow the
dashboard's needs). The native app shouldn't depend on it directly. Add a
`v1` schedule endpoint before the app is built.
