-- Rollback for migration 061. Removes head counts, temperatures and the
-- public conditions projection.
--
-- WHAT THIS DESTROYS
--
-- Every head count and temperature ever recorded, and with them the only
-- answer this product has to "how busy is it usually at this time?" — the
-- typical-attendance average is computed from these rows and has no second
-- copy. A facility that has been counting for six months loses six months.
--
-- Export first if there is any chance of wanting it back:
--
--   COPY (SELECT * FROM facility_readings) TO STDOUT WITH CSV HEADER;
--
-- WHAT THIS DOES NOT DESTROY
--
-- Nothing else reads these rows. No schedule, no session, no conflict, no
-- notice. Dropping them returns every public page to the state it had before
-- 061: the schedule, and no conditions block above it.
--
-- The three columns on `facilities` go too. They are only meaningful with the
-- feature, and leaving them behind would have a re-applied 061 silently
-- inherit publishing decisions made months earlier — including, in the worst
-- case, a facility that had opted into showing its head count.

DROP POLICY IF EXISTS "facility_readings_superadmin_all" ON facility_readings;
DROP POLICY IF EXISTS "facility_readings_delete" ON facility_readings;
DROP POLICY IF EXISTS "facility_readings_insert" ON facility_readings;
DROP POLICY IF EXISTS "facility_readings_read" ON facility_readings;

DROP FUNCTION IF EXISTS public.facility_public_conditions(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.occupancy_level(NUMERIC, INTEGER);

DROP TABLE IF EXISTS facility_readings;

ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_public_headcount_check;
ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_occupancy_capacity_check;
ALTER TABLE facilities
  DROP COLUMN IF EXISTS public_conditions,
  DROP COLUMN IF EXISTS public_headcount,
  DROP COLUMN IF EXISTS occupancy_capacity;
