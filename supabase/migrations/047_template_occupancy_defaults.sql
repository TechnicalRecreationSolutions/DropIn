-- =============================================================================
-- Migration 047: Occupancy Defaults on Session Templates
-- =============================================================================
-- Migration 046 put occupancy_kind/disclosure on `sessions`, and the full
-- session form asks for them. But staff don't live on that form — they live in
-- the command centre, dragging templates from the rail onto the grid, and that
-- path (CreateSessionDialog) doesn't ask. So a rental entered the fast way came
-- out as a public drop-in and had to be corrected afterwards on the edit form.
--
-- Asking in the dialog would fix the symptom. Putting the answer on the
-- template fixes the workload: a template already carries the name, colour and
-- default lanes for a recurring activity, and "Island Swimming" is a rental
-- with its name withheld on every single booking, forever. Once the template
-- knows that, recording next season's club slot is one drag with nothing to
-- re-pick — and nothing to forget to re-pick, which is the part that would
-- otherwise publish a renter's name by accident.
--
-- DESIGN DECISIONS
--
-- 1. Defaults, not constraints. These seed the create dialog; they do not
--    govern the session afterwards. A session's own occupancy_kind/disclosure
--    (046) stay the authority, so editing one session placed from a template
--    does not touch the others, and changing a template does not retroactively
--    republish or withhold anything already placed. That matches how
--    default_duration_minutes and session_template_spaces already behave.
--
-- 2. Same column names as `sessions`, same CHECK vocabularies. A reader
--    comparing the two tables should see the same words meaning the same
--    things; divergent spellings here would invite a mapping layer between
--    them, which is where a default silently becomes the wrong value.
--
-- 3. Defaults chosen so every one of the 12 templates that already exist keeps
--    behaving exactly as it does today: 'drop_in' + 'public'. No backfill.
--
-- 4. No visibility column on session_templates itself. A template named
--    "Island Swimming" is readable by the public today (session_templates has
--    a public-read policy, and /api/sessions/expand joins name + color), which
--    would leak the renter's name through a reserved session's template. That
--    is *already* handled in the API rather than the schema: applyDisclosure()
--    nulls templateName and templateColor for withheld sessions before they
--    reach an outsider, and verify-v asserts the name appears nowhere in a
--    public response body. Adding a second, schema-level gate here would be a
--    bigger change than it looks — the public floorplan and widget both read
--    template colours — and it is not needed while the projection holds.
--    Worth revisiting only if a surface is ever added that returns template
--    rows directly to the public.
--
-- Rollback: supabase/rollbacks/047_template_occupancy_defaults.sql
-- =============================================================================

ALTER TABLE session_templates
  ADD COLUMN occupancy_kind TEXT NOT NULL DEFAULT 'drop_in'
    CHECK (occupancy_kind IN ('drop_in', 'program', 'rental', 'closure')),
  ADD COLUMN disclosure TEXT NOT NULL DEFAULT 'public'
    CHECK (disclosure IN ('public', 'reserved', 'internal'));

COMMENT ON COLUMN session_templates.occupancy_kind IS
  'Seeds sessions.occupancy_kind when a session is placed from this template '
  '(migration 046). A default, not a constraint — the session row is the '
  'authority once placed.';

COMMENT ON COLUMN session_templates.disclosure IS
  'Seeds sessions.disclosure when a session is placed from this template. Same '
  'default-not-constraint rule as occupancy_kind above.';
