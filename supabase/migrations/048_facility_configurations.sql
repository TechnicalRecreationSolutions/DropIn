-- =============================================================================
-- Migration 048: Facility Configurations (the bulkhead)
-- =============================================================================
-- Stage 3 of docs/PLAN-internal-view.md. A 50m pool with a movable bulkhead is
-- two different buildings depending on where the bulkhead sits: 8 long-course
-- lanes, or 16 short-course ones. Staff need to say which state the pool is in,
-- and the availability calculator (stage 5) needs a real denominator — "how
-- many lanes exist right now" — which a per-session text label cannot give it.
--
-- Nothing here changes the behaviour of a single existing row: every space
-- keeps configuration_id = NULL, which means "present in every configuration".
--
-- DESIGN DECISIONS
--
-- 1. Declared, not derived. Decided with the customer 2026-09-11: the
--    transition is NOT modelled. A long-course morning and a short-course
--    afternoon are entered as two separate sessions claiming two separate sets
--    of lanes. Nothing reacts to a bulkhead moving at a set time, because in
--    practice staff move it when they move it and the schedule is what tells
--    them to. A `changes_at` column would be a promise the building does not
--    keep.
--
-- 2. NULL configuration_id means "present in every configuration", not
--    "unassigned". The hot tub, the leisure pool, the tennis court, and every
--    space at every facility with nothing reconfigurable are all NULL, so this
--    migration is a no-op for existing customers and stays a no-op for any
--    facility that never sets a configuration up. The alternative — a
--    mandatory "Default" configuration row per facility — would have meant a
--    backfill, and a tier of UI that every simple facility has to look at.
--
-- 3. Configurations live on the FACILITY, not the department or the space. A
--    bulkhead is a property of a building; two departments sharing the tank
--    must agree about where it is. Spaces point at a configuration rather than
--    configurations listing their spaces, because a space belongs to exactly
--    one (or to all of them) and that keeps the lane picker a single filter.
--
-- 4. Physical overlap is deliberately NOT modelled. 50m Lane 3 and 25m Lane 5
--    may be the same water; nothing in this schema knows that, so the
--    conflict engine cannot catch a collision across configurations. Modelling
--    the geometry would mean lane-to-lane containment maps maintained by hand
--    per facility, and getting it slightly wrong produces false 409s on
--    bookings that are fine. Instead one cheap predicate catches the real
--    mistake: a facility is in exactly one configuration at a time, so two
--    overlapping sessions claiming spaces from DIFFERENT configurations is an
--    advisory warning (src/lib/sessions/conflicts.ts, findOrgConflicts). An
--    advisory, not a 409 — see decision 5.
--
-- 5. No per-day constraint, and no hard block. A pool can be long course in
--    the morning and short course in the afternoon; the customer expects to
--    enter exactly that. So the cross-configuration check warns and never
--    refuses, and there is no "this facility is in configuration X on
--    Tuesdays" column to be wrong about. Pre-filtering the lane picker by the
--    configuration already in use that day is good UX; constraining it would
--    block a real case on the first week of use.
--
-- 6. Publicly readable, unlike session_internal (046). "Long Course (50m)" is
--    exactly what a patron wants to read next to a lane count — it is the
--    answer to "can I swim 50s tonight". There is no secret here; the secret
--    of who holds a lane lives in session_internal and is unaffected by this
--    migration.
--
-- Rollback: supabase/rollbacks/048_facility_configurations.sql
-- =============================================================================

CREATE TABLE facility_configurations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_id   UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  -- What staff call this state of the building: "Long Course (50m)",
  -- "Short Course (25m)", "Boards In", "Rink split".
  name          TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (facility_id, name)
);

COMMENT ON TABLE facility_configurations IS
  'Physical states a facility can be put into (bulkhead in/out, boards in/out). '
  'Declared by staff, never derived — see migration 048 decision 1. A space '
  'with configuration_id NULL exists in every one of them.';

ALTER TABLE facility_configurations ENABLE ROW LEVEL SECURITY;

-- Mirrors spaces_public_read_published's shape, but gated on the *facility*
-- being published rather than on a flag of its own: a configuration has no
-- independent publish state, and its name is only ever read alongside the
-- spaces it labels (decision 6).
CREATE POLICY "facility_configurations_public_read"
  ON facility_configurations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM facilities f
      WHERE f.id = facility_configurations.facility_id AND f.is_published = TRUE
    )
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

CREATE POLICY "facility_configurations_members_crud"
  ON facility_configurations FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "facility_configurations_superadmin_all"
  ON facility_configurations FOR ALL
  USING (public.is_superadmin());

CREATE INDEX idx_facility_configurations_facility_id
  ON facility_configurations (facility_id);
CREATE INDEX idx_facility_configurations_org_id
  ON facility_configurations (org_id);

-- =============================================================================
-- spaces.configuration_id — NULL means "in every configuration" (decision 2)
-- =============================================================================
-- ON DELETE SET NULL, not CASCADE: deleting a configuration must never delete
-- lanes. A facility that stops splitting its tank should end up with every
-- lane present in every configuration — which is exactly what NULL means —
-- not with half its spaces gone and the sessions attached to them orphaned.
ALTER TABLE spaces
  ADD COLUMN configuration_id UUID REFERENCES facility_configurations(id) ON DELETE SET NULL;

COMMENT ON COLUMN spaces.configuration_id IS
  'Which facility configuration this space exists in. NULL = every '
  'configuration (the default, and correct for any facility that has none).';

CREATE INDEX idx_spaces_configuration_id ON spaces (configuration_id);

-- No CHECK that configuration_id's facility matches the space's facility:
-- a cross-table CHECK is not expressible without a trigger, and the API
-- (POST/PATCH /api/spaces) verifies it the same way it already verifies
-- department_id, which has the identical gap. Stated here so the absence
-- reads as a decision rather than an oversight.
