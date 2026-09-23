# Conditions

Head counts and temperatures: what staff record, and what patrons get.

```
lifeguard → /dashboard/counts ─► POST /api/facilities/[id]/readings
                                          │
                                          └─► facility_readings (migration 061)
                                                      │
                                       facility_public_conditions()  ← SECURITY DEFINER
                                                      │
                          GET /api/public/v1/facility/[id]/conditions  (30 s edge cache)
                                                      │
                     <FacilityConditions> on /facility/[slug] and in the widget (60 s poll)

manager  → /dashboard/facilities/[id]/status#public ─► PATCH /api/facilities/[id]
                                                        (public_conditions, public_headcount,
                                                         occupancy_capacity)
```

| File | Job |
|---|---|
| `readings.ts` | The domain. Metric vocabulary, bounds, freshness windows, formatting, and the UTC-offset sign convention. Client-safe. |
| `types.ts` | The `v1` wire contract for the public endpoint. |

## One table, two features

A head count and a water temperature are the same object — a number, about a
place, at a moment, written by a person — so they are one table with a `metric`
column. The argument, and what it costs, is in the header of
`supabase/migrations/061_facility_readings.sql`. Read that before changing
anything here.

## Five things that are easy to get wrong

**1. It is append-only, and there is no UPDATE policy.** `Update` is typed
`never`. A wrong count is corrected by recording another — the newest is what
publishes — and a genuine mistake is deleted. Adding an UPDATE policy would let
the record show a number nobody observed.

**2. A stale reading changes its claim, it does not just get a caveat.** Fresh:
"About 40 here · 2:15 PM". Stale with history: "Usually about 35 at this time",
a different sentence about a different thing. Stale with no history: nothing at
all. "40 people (four hours ago)" is read as "40 people", which is why that
branch does not exist. `FacilityConditions.describe()` has all four cases in
one function for exactly this reason.

**3. In `level` mode the exact count never leaves the database.** The
projection returns a band instead, so it is not a display choice a future route
could undo. Its corollary: **`level` with no capacity omits the reading**
rather than falling back to the number — because the fallback would publish
what the mode exists to withhold. The settings form warns about this, since the
failure is otherwise silent.

**4. `facility_readings` has no public read policy.** The public path is
`facility_public_conditions()`, and that is the whole boundary. Do not add a
public SELECT policy "for convenience"; the band would stop meaning anything.

**5. Weekday and hour are LOCAL, and Postgres is told which local.** "Usually
at this time" buckets on the caller's clock, passed in as
`p_utc_offset_minutes` — `localUtcOffsetMinutes()` owns the sign. One offset is
applied across the whole eight-week window, so the older half is an hour out
across a DST boundary. Fine for "how busy is it usually"; not fine for anything
billed or reported, and this function must not become the source for either.

## Notices are the other half, and they work the opposite way

Facility notices (`src/lib/status/`) are **server-rendered** from a
`cacheLife("minutes")` entry and expired by a cache tag — a closure has to be in
the HTML. Conditions are **client-fetched** on a 60-second poll — a live number
in a server cache is a stale number wearing a fresh timestamp. Both decisions
are load-bearing and neither should be made to match the other.

`FacilityConditions` also deliberately does **not** use TanStack Query: the
widget mounts its `QueryClientProvider` inside `WidgetScheduleClient`, so a
`useQuery` in a sibling throws and takes the embed down.

## Verifying

```bash
node --experimental-strip-types scripts/verify/verify-ba.mjs --logic-only   # 14, no server
node --experimental-strip-types scripts/verify/verify-ba.mjs                # needs 061 applied
```

## Not built

- **Sensor or BMS integration.** Manual entry only. The table is shaped for it
  — a `source` column is the whole change — but nothing speculative ships.
- **Per-space publishing settings.** Publishing is per facility; a space-level
  count uses `spaces.capacity` for its band but cannot be published separately.
- **Chlorine, pH, air quality.** They would be `metric` values and nothing else
  would move.
