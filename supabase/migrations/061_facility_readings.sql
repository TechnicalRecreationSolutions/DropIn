-- =============================================================================
-- Migration 061: Facility readings — head counts and temperatures
-- =============================================================================
-- Two questions a recreation centre is asked on the phone all day, and cannot
-- answer from anything this app stores:
--
--   "How busy is the pool right now?"
--   "How warm is the water?"
--
-- Both are OBSERVATIONS: a number, about a place, at a moment, written down by
-- a person who was standing there. That is one shape, and this is one table for
-- it.
--
--
-- WHY HEAD COUNTS AND TEMPERATURES SHARE A TABLE
--
-- They look like different features and are the same object. Each is a numeric
-- value, attached to a facility or one of its spaces, stamped with when it was
-- taken and by whom, and never edited afterwards. Splitting them would mean two
-- tables with identical columns, two RLS policy sets, two input forms, two
-- public projections and two aggregate queries — and the moment a third metric
-- appears (chlorine, pH, air quality) the split has to be argued again.
--
-- Keeping them together also gives the temperatures a history for free, which
-- turns out to be the more useful half: one water temperature is a fact, a
-- month of them is a boiler that is failing.
--
-- The cost is a `metric` column carrying a small closed vocabulary and two
-- CHECK constraints that apply to different members of it. That is a fair
-- price and it is written out below rather than hidden.
--
--
-- ⚠️ APPEND-ONLY. THERE IS NO UPDATE POLICY, ON PURPOSE.
--
-- An observation is not editable. "There were 40 people in the pool at 2:15"
-- either happened or it did not; changing it later produces a record of
-- something nobody observed. A guard who miscounts records another count — the
-- newest one is what the public sees — and a guard who typed 400 instead of 40
-- DELETES that row.
--
-- So: INSERT and DELETE have policies, SELECT has a policy, and UPDATE has
-- none, which under RLS means nobody can do it. Do not "fix" that.
--
--
-- NO `note` COLUMN — the 046 lesson, applied before it can bite
--
-- A free-text note ("swim club arrived early") is the obvious next column and
-- it must not go here. RLS is row-level: any column on a row that a public
-- projection can reach is one `select("*")` away from being published. 046
-- solved exactly this by putting the renter's name in `session_internal`, a
-- sidecar with no public policy at all. If notes are wanted, they go the same
-- way.
--
--
-- UNITS ARE FIXED AND UNSTORED
--
-- Temperatures are degrees CELSIUS. Head counts are people. There is no `unit`
-- column because there is no second answer: nothing in this application is
-- imperial, every facility in the database is Canadian, and a nullable unit
-- column is a column every reader has to remember to check. A future US
-- deployment converts on the way out, not in the table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The readings
-- -----------------------------------------------------------------------------

CREATE TABLE facility_readings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  -- Denormalized from the parent for RLS, same as every other child table.
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- NULL = the whole building. A named space narrows it: "42 in the building"
  -- and "18 in the lane pool" are both real answers and a centre may want both
  -- at once. Same nullable-scope shape as facility_notices (060).
  space_id    UUID REFERENCES spaces(id) ON DELETE CASCADE,

  metric      TEXT NOT NULL CHECK (metric IN ('headcount', 'water_temp_c', 'air_temp_c')),

  -- NUMERIC rather than INTEGER because two of the three metrics have a
  -- decimal (27.5 °C is a real reading), and the third is constrained to whole
  -- numbers below rather than by its storage type.
  value       NUMERIC(6, 2) NOT NULL,

  -- Defaults to now() because that is the overwhelming case — a guard entering
  -- a count they just took. Writable so a count taken on paper at the top of
  -- the hour can be entered at ten past with the right time on it.
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- You cannot have -3 people, and you cannot have 40.5 of them.
  CONSTRAINT facility_readings_headcount_whole CHECK (
    metric <> 'headcount' OR (value >= 0 AND value = trunc(value))
  ),
  -- A pool is 26-30 °C and a change room is 22-24 °C. The range is wide enough
  -- to accept an ice rink's air (-5) and a hot tub (40) while still catching
  -- the two mistakes that actually happen: a Fahrenheit number typed into a
  -- Celsius field (82), and a head count typed into a temperature field.
  CONSTRAINT facility_readings_temp_range CHECK (
    metric = 'headcount' OR (value >= -20 AND value <= 50)
  )
);

COMMENT ON TABLE facility_readings IS
  'Observations about a facility or one of its spaces: head counts and '
  'temperatures (migration 061). APPEND-ONLY — there is deliberately no UPDATE '
  'policy. Correct a count by recording another; delete a mistake.';

COMMENT ON COLUMN facility_readings.value IS
  'People for headcount, degrees CELSIUS for the temperatures. No unit column '
  'and no second answer — see the migration header.';

-- "The latest headcount at this facility", which is both the public read and
-- the first thing the input tool shows.
CREATE INDEX idx_facility_readings_latest
  ON facility_readings (facility_id, metric, recorded_at DESC);

-- The same question asked about one space.
CREATE INDEX idx_facility_readings_space
  ON facility_readings (space_id, metric, recorded_at DESC)
  WHERE space_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 2. RLS
-- -----------------------------------------------------------------------------

ALTER TABLE facility_readings ENABLE ROW LEVEL SECURITY;

-- Read: staff who hold the facility. NOT the public.
--
-- The public path is the SECURITY DEFINER function in section 4, which returns
-- a PROJECTION — the latest value, or a busyness band, according to what the
-- facility chose to publish. A public row-level policy could not express that:
-- "level" mode must never let the exact number out, and a row policy either
-- releases the row or does not.
--
-- This is the same reasoning as 046's session_internal sidecar, reached from
-- the other direction: there, a whole row had to stay private; here, a row has
-- to become public in a reduced form. Both make the redaction a property of
-- the database rather than a thing every API route has to remember.
CREATE POLICY "facility_readings_read"
  ON facility_readings FOR SELECT
  USING (public.can_read_facility(facility_id) OR public.is_superadmin());

-- Insert: any staffer who holds the facility — INCLUDING AUX.
--
-- This is the first write an aux staffer has ever had, and it is deliberately
-- unconditional: unlike a notice (060), which an organization opts into
-- because it changes what the public is told, a head count is the observation
-- the guard is already making. A tool only a manager can use is a tool nobody
-- uses at 6am, and the fallback is the clipboard this replaces.
--
-- `recorded_by = auth.uid()` is enforced here rather than trusted from the
-- payload, so the log cannot be written in somebody else's name.
CREATE POLICY "facility_readings_insert"
  ON facility_readings FOR INSERT
  WITH CHECK (
    public.can_read_facility(facility_id)
    AND recorded_by = auth.uid()
  );

-- Delete: your own mistake, or anything if you run the place.
--
-- Deliberately not scoped by time. A "you have 5 minutes to undo" rule sounds
-- careful and means a guard who notices at the end of their shift that they
-- typed 400 has to find a manager, so the wrong number stays in the average
-- instead.
CREATE POLICY "facility_readings_delete"
  ON facility_readings FOR DELETE
  USING (recorded_by = auth.uid() OR public.org_can_manage(org_id));

-- NO UPDATE POLICY. See the header. Adding one is a product decision, not a
-- gap.

CREATE POLICY "facility_readings_superadmin_all"
  ON facility_readings FOR ALL
  USING (public.is_superadmin());


-- -----------------------------------------------------------------------------
-- 3. What a facility chooses to publish
-- -----------------------------------------------------------------------------
-- Three columns on `facilities`, all defaulting to "publish nothing". Every
-- existing facility therefore behaves exactly as it did before this migration,
-- and a centre that never opens the settings never shows a number it did not
-- choose to show.

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS public_conditions BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_headcount  TEXT NOT NULL DEFAULT 'hidden',
  ADD COLUMN IF NOT EXISTS occupancy_capacity INTEGER;

ALTER TABLE facilities
  DROP CONSTRAINT IF EXISTS facilities_public_headcount_check;
ALTER TABLE facilities
  ADD CONSTRAINT facilities_public_headcount_check
  CHECK (public_headcount IN ('hidden', 'count', 'level'));

ALTER TABLE facilities
  DROP CONSTRAINT IF EXISTS facilities_occupancy_capacity_check;
ALTER TABLE facilities
  ADD CONSTRAINT facilities_occupancy_capacity_check
  CHECK (occupancy_capacity IS NULL OR occupancy_capacity > 0);

COMMENT ON COLUMN facilities.public_conditions IS
  'Publish water and air temperatures on the public page (migration 061).';

COMMENT ON COLUMN facilities.public_headcount IS
  'How much of the head count patrons get: hidden, the exact count, or a '
  'busyness band ("quiet"/"busy"). A band needs a capacity to divide by — '
  'occupancy_capacity here, or spaces.capacity for a space-level count — and '
  'without one the band is omitted rather than guessed.';

COMMENT ON COLUMN facilities.occupancy_capacity IS
  'How many people the building holds. The denominator for public_headcount = '
  'level, and nothing else reads it. Per-space counts use spaces.capacity.';


-- -----------------------------------------------------------------------------
-- 4. The public projection
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER, granted to anon. Returns what the facility chose to
-- publish and nothing else, so "level" mode cannot leak the exact number even
-- if a future API route forgets the rule.
--
--
-- WHY `p_utc_offset_minutes` EXISTS, AND WHAT IT COSTS
--
-- "Usually about 35 at this time" means: the average of past readings taken on
-- the same weekday, in the same hour. Weekday and hour are LOCAL concepts, and
-- migration 036 deliberately removed the stored timezone — every calendar
-- surface in this app reads the runtime's clock instead. Postgres has no idea
-- what that is (PostgREST runs in UTC), so the caller passes its offset, the
-- same way every other local-time decision here is made by the runtime.
--
-- Pass minutes to ADD to UTC: `-new Date().getTimezoneOffset()`. Pacific
-- daylight time is -420.
--
-- ⚠️ ONE OFFSET IS APPLIED ACROSS THE WHOLE LOOKBACK. Across a DST boundary
-- the older half of the window is bucketed an hour out. For an eight-week
-- average of how busy a pool is, that is an acceptable error and a documented
-- one; it is not acceptable for anything billed or reported, and this function
-- must not become the source for either.
--
--
-- FRESHNESS IS BOUNDED HERE AND REFINED IN THE CLIENT
--
-- Nothing older than 24 hours is returned at all — a day-old head count is not
-- a fact about now under any interpretation, and a caller that forgot to check
-- would publish one. The finer per-metric rules (90 minutes for a head count,
-- 12 hours for a temperature) live in src/lib/conditions/freshness.ts, because
-- they decide how the number is WORDED, which is a presentation question.

-- The busyness band, factored out so the thresholds exist once.
--
-- Four bands, not three or five: "quiet" and "busy" are the two a patron acts
-- on, "moderate" is the honest middle, and "full" has to be distinguishable
-- from "busy" because it means do not come.
CREATE OR REPLACE FUNCTION public.occupancy_level(p_value NUMERIC, p_capacity INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_capacity IS NULL OR p_capacity <= 0 THEN NULL
    WHEN p_value / p_capacity < 0.35 THEN 'quiet'
    WHEN p_value / p_capacity < 0.70 THEN 'moderate'
    WHEN p_value / p_capacity < 0.95 THEN 'busy'
    ELSE 'full'
  END;
$$;

CREATE OR REPLACE FUNCTION public.facility_public_conditions(
  p_facility_id         UUID,
  p_utc_offset_minutes  INTEGER DEFAULT 0
)
RETURNS TABLE (
  space_id      UUID,
  space_name    TEXT,
  metric        TEXT,
  -- NULL in 'level' mode. The whole point of the mode.
  value         NUMERIC,
  -- NULL unless this is a head count in 'level' mode.
  level         TEXT,
  recorded_at   TIMESTAMPTZ,
  -- Head counts only, and only when there is enough history to mean anything.
  typical_value NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
-- Every column reference in the query below is table-qualified, so plpgsql
-- has nothing to confuse with the RETURNS TABLE names (space_id, metric,
-- value, level...). This says so explicitly rather than relying on it: one
-- unqualified `value` added later would otherwise resolve to the OUT
-- parameter and return NULL, silently, for every row.
#variable_conflict use_column
DECLARE
  v_facility     RECORD;
  v_offset       INTERVAL := make_interval(mins => COALESCE(p_utc_offset_minutes, 0));
BEGIN
  SELECT f.id, f.is_published, f.public_conditions, f.public_headcount, f.occupancy_capacity
    INTO v_facility
    FROM facilities f
   WHERE f.id = p_facility_id;

  -- An unpublished facility publishes nothing, whatever its other settings
  -- say. Same gate as the notices policy in 060.
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT v_facility.is_published THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH latest AS (
    -- One row per (space, metric): the most recent reading in the last day.
    SELECT DISTINCT ON (r.space_id, r.metric)
           r.space_id, r.metric, r.value, r.recorded_at
      FROM facility_readings r
     WHERE r.facility_id = p_facility_id
       AND r.recorded_at > NOW() - INTERVAL '24 hours'
     ORDER BY r.space_id, r.metric, r.recorded_at DESC
  ),
  typical AS (
    -- The same weekday and hour, over the preceding eight weeks, head counts
    -- only. Joined to `latest` so this costs nothing for a facility that has
    -- no current reading to attach it to.
    SELECT l.space_id,
           ROUND(AVG(h.value), 0) AS avg_value,
           COUNT(*)               AS sample_size
      FROM latest l
      JOIN facility_readings h
        ON h.facility_id = p_facility_id
       AND h.metric      = 'headcount'
       AND h.space_id IS NOT DISTINCT FROM l.space_id
       AND h.recorded_at > NOW() - INTERVAL '8 weeks'
       -- Local weekday and hour, per the offset note above.
       AND EXTRACT(DOW  FROM (h.recorded_at AT TIME ZONE 'UTC') + v_offset)
         = EXTRACT(DOW  FROM (NOW()         AT TIME ZONE 'UTC') + v_offset)
       AND EXTRACT(HOUR FROM (h.recorded_at AT TIME ZONE 'UTC') + v_offset)
         = EXTRACT(HOUR FROM (NOW()         AT TIME ZONE 'UTC') + v_offset)
     WHERE l.metric = 'headcount'
     GROUP BY l.space_id
  )
  SELECT
    l.space_id,
    s.name AS space_name,
    l.metric,
    -- Temperatures pass through when published. A head count passes through
    -- only in 'count' mode — in 'level' mode this is NULL and the band below
    -- carries the answer.
    CASE
      WHEN l.metric = 'headcount' AND v_facility.public_headcount = 'count' THEN l.value
      WHEN l.metric <> 'headcount' THEN l.value
      ELSE NULL
    END AS value,
    CASE
      WHEN l.metric = 'headcount' AND v_facility.public_headcount = 'level'
      THEN public.occupancy_level(
             l.value,
             COALESCE(s.capacity, v_facility.occupancy_capacity)
           )
      ELSE NULL
    END AS level,
    l.recorded_at,
    -- Three readings is the smallest sample worth calling "usually". Below it
    -- the answer is one quiet Tuesday, and a wrong "usually" is worse than no
    -- "usually" — the patron acts on it.
    CASE WHEN l.metric = 'headcount' AND t.sample_size >= 3 THEN t.avg_value END AS typical_value
  FROM latest l
  LEFT JOIN spaces  s ON s.id = l.space_id
  LEFT JOIN typical t ON t.space_id IS NOT DISTINCT FROM l.space_id
  WHERE
    CASE
      WHEN l.metric = 'headcount' THEN v_facility.public_headcount <> 'hidden'
      ELSE v_facility.public_conditions
    END
    -- A band with no capacity to divide by is not a band. Dropping the row is
    -- the honest answer; showing the raw number instead would publish exactly
    -- what 'level' mode exists to withhold.
    AND NOT (
      l.metric = 'headcount'
      AND v_facility.public_headcount = 'level'
      AND COALESCE(s.capacity, v_facility.occupancy_capacity) IS NULL
    )
    -- A published space, or the whole facility. An unpublished space is not
    -- something patrons have a name for.
    AND (l.space_id IS NULL OR s.is_published);
END;
$$;

COMMENT ON FUNCTION public.facility_public_conditions(UUID, INTEGER) IS
  'The public view of a facility''s current conditions (migration 061). '
  'Returns only what the facility opted to publish; in headcount = level mode '
  'the exact count NEVER leaves this function. Pass the caller''s UTC offset '
  'in minutes (-getTimezoneOffset()) so "usually at this time" buckets on the '
  'local weekday and hour.';

-- anon needs it; authenticated gets it too so the dashboard's own preview of
-- the public page does not have to be a second code path.
GRANT EXECUTE ON FUNCTION public.facility_public_conditions(UUID, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.occupancy_level(NUMERIC, INTEGER) TO anon, authenticated;


-- =============================================================================
-- VERIFYING
-- =============================================================================
--   node --experimental-strip-types scripts/verify/verify-ba.mjs
--
-- The assertions that matter, each falsified to prove it bites:
--   * an aux staffer CAN insert a reading, and CANNOT update one;
--   * a never-signed-in client selecting facility_readings gets zero rows,
--     while facility_public_conditions() returns the projected value — the two
--     together are what prove the boundary, not either alone;
--   * in 'level' mode the exact count is absent at every capacity, and the
--     band matches the thresholds at each edge;
--   * 'level' with no capacity anywhere omits the row rather than falling back
--     to the number;
--   * typical_value matches a hand-computed fixture, is absent below three
--     samples, and differs at a second facility so it cannot pass by constant.
-- =============================================================================
