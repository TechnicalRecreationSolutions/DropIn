-- =============================================================================
-- Migration 052: Facility directory listing
-- =============================================================================
-- Dropin is getting a public directory again (/find): a resident with no
-- account searches for nearby centres and opens their schedules. Discovery was
-- deleted on 2026-08-12 (ef0a035) and brought back on 2026-09-16 as a
-- deliberate decision. See docs/PLAN.md.
--
--  1. `listed_in_directory` — a separate opt-in, OFF by default.
--
--     `is_published` already means "this building has a public page and an
--     embeddable schedule". Centres turned that on to publish their *own*
--     schedule, not to appear in a cross-organization index, so reusing it
--     would list every existing customer without asking. The directory reads
--     `is_published AND listed_in_directory`. There is no CHECK tying the two
--     together: a centre can decide to be listed before it publishes, and the
--     reader's AND is the single place the rule lives.
--
--     No new RLS policy. `facilities_public_read_published` (002) already lets
--     anyone read a published facility row in full; the directory is a filter
--     over rows that are already public, not new exposure.
--
--  2. `location` follows `lat`/`lng` by trigger.
--
--     The three columns date from 001 and were written together by the old
--     Mapbox geocoder. Since ef0a035 nothing writes any of them. The app now
--     writes lat/lng again (Nominatim, src/lib/geo/geocode.ts); v1 sorts by
--     distance on the client and never reads `location`, but a PostGIS radius
--     search will once there are enough centres to need one, and a geography
--     column that silently disagrees with lat/lng is worse than none. The
--     trigger makes lat/lng the only thing a writer can set.
--
--  3. `geocoded_at` — when lat/lng were last resolved from the address.
--
--     NULL with NULL coordinates means "never looked up" (every facility saved
--     since ef0a035); a timestamp with NULL coordinates means "looked up, and
--     the address was not found". The form tells staff which, and the backfill
--     script only retries the first kind by default, so a bad address is not
--     re-sent to Nominatim on every run.
--
-- Rollback: supabase/rollbacks/052_facility_directory_listing.sql
-- =============================================================================

ALTER TABLE facilities
  ADD COLUMN listed_in_directory BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN geocoded_at TIMESTAMPTZ;

COMMENT ON COLUMN facilities.listed_in_directory IS
  'Opt-in to the public Dropin directory (/find). Only honoured while '
  'is_published is also true.';
COMMENT ON COLUMN facilities.geocoded_at IS
  'When lat/lng were last resolved from the address. Set with NULL lat/lng '
  'when the lookup found nothing.';

CREATE OR REPLACE FUNCTION public.facilities_sync_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.lat IS NULL OR NEW.lng IS NULL THEN
    NEW.location := NULL;
  ELSE
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$;

-- Fires on every insert and on any update that touches a coordinate or the
-- location itself, so a writer that sets `location` directly is overwritten
-- from lat/lng rather than allowed to disagree with them.
CREATE TRIGGER facilities_sync_location
  BEFORE INSERT OR UPDATE OF lat, lng, location ON facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.facilities_sync_location();

-- Bring existing rows into line. Fires the trigger above.
UPDATE facilities SET lat = lat WHERE lat IS NOT NULL OR location IS NOT NULL;
