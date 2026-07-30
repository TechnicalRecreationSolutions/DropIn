-- =============================================================================
-- Migration 020: Multi-space sessions
-- =============================================================================
-- A session used to attach to at most one Space (sessions.space_id, added in
-- 012). That breaks down for an activity like "Lap Swim" that runs across
-- Lanes 1-4 simultaneously as ONE logical recurring session — modeling that
-- as 4 separate session rows would mean 4x the edits/drags/cancellations to
-- keep in sync, and 4 separate (possibly drifting) blocks on every schedule
-- view instead of one.
--
-- session_spaces is a plain many-to-many join table: one row per
-- (session, space) pairing. A session with zero rows here has "no space
-- assigned" — the same meaning sessions.space_id IS NULL used to carry.
-- ON DELETE CASCADE from both sides: deleting a session or a space should
-- silently drop the membership row, never block the delete.
--
-- org_id is denormalized onto the junction row (rather than joining through
-- sessions -> schedule_groups -> org_id for every RLS check), matching the
-- existing convention on space_hotspots, map_context_elements, and
-- session_exceptions — every one of those tables carries org_id despite it
-- being derivable through a parent FK, specifically so the org-scoped CRUD
-- policy stays a flat org_id check.
--
-- Public read mirrors exceptions_public_read's pattern exactly (002/011):
-- readable directly for org members/superadmin, and for anyone else only
-- through an EXISTS join back to the owning session's own publish/active
-- gating — never a blanket USING (TRUE), since that would let an
-- unauthenticated caller enumerate space_id pairings for sessions that
-- aren't otherwise publicly visible (e.g. an unpublished schedule group).
--
-- session_template_spaces mirrors this for session_templates.default_space_id,
-- so selecting a "Lap Swim" template pre-fills all 4 lanes when placing a new
-- session from it. No public-read policy, matching session_templates itself
-- (013) — templates are an internal authoring construct, never rendered on
-- the public widget.
--
-- Both sessions.space_id and session_templates.default_space_id are backfilled
-- into their respective join tables, then dropped outright — this app ships
-- schema and code together in one deploy, so there is no window where old
-- code needs the old column to still exist.
-- =============================================================================

CREATE TABLE session_spaces (
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  space_id    UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, space_id)
);

ALTER TABLE session_spaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "session_spaces_public_read"
  ON session_spaces FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_spaces.session_id
      AND s.is_active = TRUE AND sg.is_published = TRUE
    )
  );

CREATE POLICY "session_spaces_members_crud"
  ON session_spaces FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "session_spaces_superadmin_all"
  ON session_spaces FOR ALL
  USING (public.is_superadmin());

CREATE INDEX idx_session_spaces_session_id ON session_spaces (session_id);
CREATE INDEX idx_session_spaces_space_id ON session_spaces (space_id);
CREATE INDEX idx_session_spaces_org_id ON session_spaces (org_id);

CREATE TABLE session_template_spaces (
  session_template_id  UUID NOT NULL REFERENCES session_templates(id) ON DELETE CASCADE,
  space_id             UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  org_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_template_id, space_id)
);

ALTER TABLE session_template_spaces ENABLE ROW LEVEL SECURITY;

-- Deliberately no public-read policy, matching session_templates itself (013).
CREATE POLICY "session_template_spaces_members_crud"
  ON session_template_spaces FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "session_template_spaces_superadmin_all"
  ON session_template_spaces FOR ALL
  USING (public.is_superadmin());

CREATE INDEX idx_session_template_spaces_template_id ON session_template_spaces (session_template_id);
CREATE INDEX idx_session_template_spaces_space_id ON session_template_spaces (space_id);
CREATE INDEX idx_session_template_spaces_org_id ON session_template_spaces (org_id);

-- =============================================================================
-- Backfill from the old single-FK columns, then drop them.
-- =============================================================================
INSERT INTO session_spaces (session_id, space_id, org_id)
SELECT id, space_id, org_id FROM sessions WHERE space_id IS NOT NULL;

INSERT INTO session_template_spaces (session_template_id, space_id, org_id)
SELECT id, default_space_id, org_id FROM session_templates WHERE default_space_id IS NOT NULL;

DROP INDEX IF EXISTS idx_sessions_space_id;
ALTER TABLE sessions DROP COLUMN space_id;

ALTER TABLE session_templates DROP COLUMN default_space_id;
