-- =============================================================================
-- Migration 011: Collapse Program into Schedule Group
-- =============================================================================
-- Program and Schedule Group were the same real-world object ("Lane Swim" /
-- "Lap Swimming" — a named thing with a cost, age group, and sessions
-- attached) split across two disconnected entities. This migration merges
-- Program's fields onto schedule_groups and repoints sessions to reference
-- schedule_groups directly. The programs table and sessions.program_id go
-- away entirely.
--
-- New chain: Facility -> Department (optional) -> Schedule Group -> Session.
-- schedule_groups.facility_id becomes the mandatory anchor (Program's old
-- role); schedule_groups.department_id becomes nullable, so a schedule
-- group can still be created without a department — the same flexibility
-- principle that applied to programs.department_id before this migration.
-- =============================================================================

-- Step 1: add Program's columns to schedule_groups (nullable during backfill)
ALTER TABLE schedule_groups
  ADD COLUMN facility_id UUID REFERENCES facilities(id) ON DELETE CASCADE,
  ADD COLUMN sport_category TEXT,
  ADD COLUMN activity_type TEXT CHECK (activity_type IN ('drop_in','registered','open_gym')),
  ADD COLUMN age_group TEXT,
  ADD COLUMN skill_level TEXT,
  ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN cost_notes TEXT,
  ADD COLUMN max_participants INTEGER,
  ADD COLUMN photo_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','imported'));

ALTER TABLE sessions
  ADD COLUMN schedule_group_id UUID REFERENCES schedule_groups(id) ON DELETE CASCADE;

-- Relax department_id to nullable NOW, before any backfill inserts —
-- programs with no department (e.g. Pickleball Open Play) need to insert a
-- schedule_group row with department_id = NULL in step 3 below.
ALTER TABLE schedule_groups ALTER COLUMN department_id DROP NOT NULL;

-- =============================================================================
-- Step 2: backfill case A — program already has a schedule_group_id.
-- Overwrite the (placeholder) schedule_group row with the program's real data.
-- =============================================================================
UPDATE schedule_groups sg SET
  name = p.name,
  slug = p.slug,
  description = p.description,
  sport_category = p.sport_category,
  activity_type = p.activity_type,
  age_group = p.age_group,
  skill_level = p.skill_level,
  cost_cents = p.cost_cents,
  cost_notes = p.cost_notes,
  max_participants = p.max_participants,
  photo_urls = p.photo_urls,
  tags = p.tags,
  is_published = p.is_published,
  source = p.source,
  facility_id = p.facility_id
FROM programs p
WHERE sg.id = p.schedule_group_id;

UPDATE sessions s SET schedule_group_id = p.schedule_group_id
FROM programs p
WHERE s.program_id = p.id AND p.schedule_group_id IS NOT NULL;

-- =============================================================================
-- Step 3: backfill case B — program has no schedule_group_id. Create one new
-- schedule_group per such program (1:1), then point that program's sessions
-- at it. A temp mapping table makes this correct and auditable rather than
-- relying on RETURNING row-order matching.
-- =============================================================================
CREATE TEMP TABLE program_sg_map (program_id UUID PRIMARY KEY, schedule_group_id UUID NOT NULL);

INSERT INTO program_sg_map (program_id, schedule_group_id)
SELECT p.id, gen_random_uuid() FROM programs p WHERE p.schedule_group_id IS NULL;

INSERT INTO schedule_groups (
  id, org_id, facility_id, department_id, name, slug, description,
  sport_category, activity_type, age_group, skill_level, cost_cents,
  cost_notes, max_participants, photo_urls, tags, is_published, source
)
SELECT
  m.schedule_group_id, p.org_id, p.facility_id, p.department_id, p.name, p.slug, p.description,
  p.sport_category, p.activity_type, p.age_group, p.skill_level, p.cost_cents,
  p.cost_notes, p.max_participants, p.photo_urls, p.tags, p.is_published, p.source
FROM programs p
JOIN program_sg_map m ON m.program_id = p.id;

UPDATE sessions s SET schedule_group_id = m.schedule_group_id
FROM programs p JOIN program_sg_map m ON m.program_id = p.id
WHERE s.program_id = p.id AND p.schedule_group_id IS NULL;

-- =============================================================================
-- Step 4: verify no orphans before destructive changes
-- =============================================================================
DO $$
DECLARE orphan_count INTEGER;
BEGIN
  SELECT count(*) INTO orphan_count FROM sessions WHERE schedule_group_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Migration aborted: % sessions have no schedule_group_id after backfill', orphan_count;
  END IF;
END $$;

-- =============================================================================
-- Step 5: dependents on sessions.program_id / programs — replace/repoint
-- before dropping, in dependency order (materialized view -> policies -> FK -> table).
-- =============================================================================

-- 5a. analytics_daily_summary (materialized view) reads analytics_events.program_id
-- and would block the FK drop below — drop and recreate against the renamed column.
-- analytics_events itself is not yet wired into any application code (confirmed
-- earlier this session), so repointing its FK to schedule_groups is a clean rename,
-- not a data migration.
DROP MATERIALIZED VIEW analytics_daily_summary;

ALTER TABLE analytics_events RENAME COLUMN program_id TO schedule_group_id;
ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_program_id_fkey;
ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_schedule_group_id_fkey
    FOREIGN KEY (schedule_group_id) REFERENCES schedule_groups(id) ON DELETE SET NULL;

CREATE MATERIALIZED VIEW analytics_daily_summary AS
  SELECT
    org_id,
    event_type,
    schedule_group_id,
    facility_id,
    DATE(occurred_at) AS day,
    COUNT(*) AS event_count
  FROM analytics_events
  GROUP BY org_id, event_type, schedule_group_id, facility_id, DATE(occurred_at);

-- 5b. sessions_public_read_active references programs via sessions.program_id
DROP POLICY "sessions_public_read_active" ON sessions;
CREATE POLICY "sessions_public_read_active"
  ON sessions FOR SELECT
  USING (
    (
      is_active = TRUE
      AND EXISTS (
        SELECT 1 FROM schedule_groups sg
        WHERE sg.id = sessions.schedule_group_id AND sg.is_published = TRUE
      )
    )
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

-- 5c. exceptions_public_read (on session_exceptions) also joins sessions -> programs
DROP POLICY "exceptions_public_read" ON session_exceptions;
CREATE POLICY "exceptions_public_read"
  ON session_exceptions FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_exceptions.session_id
      AND s.is_active = TRUE AND sg.is_published = TRUE
    )
  );

-- =============================================================================
-- Step 6: drop the old chain, tighten the new one
-- =============================================================================
ALTER TABLE sessions DROP COLUMN program_id;
DROP TABLE programs;

ALTER TABLE schedule_groups
  ALTER COLUMN facility_id SET NOT NULL,
  ALTER COLUMN sport_category SET NOT NULL;

ALTER TABLE sessions ALTER COLUMN schedule_group_id SET NOT NULL;

ALTER TABLE schedule_groups DROP CONSTRAINT schedule_groups_department_id_slug_key;
ALTER TABLE schedule_groups ADD CONSTRAINT schedule_groups_facility_id_slug_key UNIQUE (facility_id, slug);

CREATE INDEX idx_schedule_groups_facility_id ON schedule_groups (facility_id);
CREATE INDEX idx_schedule_groups_sport_published ON schedule_groups (sport_category, is_published);
CREATE INDEX idx_sessions_schedule_group_id ON sessions (schedule_group_id);

-- program_sg_map is a TEMP TABLE — it's automatically dropped at the end of
-- the database session, no explicit DROP needed (and attempting one here
-- was observed to fail in the Supabase SQL Editor, which appears not to
-- guarantee the temp table survives to the final statement of a long script).
