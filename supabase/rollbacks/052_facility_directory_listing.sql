-- Rollback for 052_facility_directory_listing.sql.
--
-- Dropping listed_in_directory unlists every facility, which is the state
-- before 052. lat/lng/location keep whatever the trigger last wrote; they are
-- consistent with each other at that point, and nothing is lost by leaving
-- them.
DROP TRIGGER IF EXISTS facilities_sync_location ON facilities;
DROP FUNCTION IF EXISTS public.facilities_sync_location();

ALTER TABLE facilities
  DROP COLUMN IF EXISTS listed_in_directory,
  DROP COLUMN IF EXISTS geocoded_at;
