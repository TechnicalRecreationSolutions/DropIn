-- =============================================================================
-- Migration 013: Session Templates
-- =============================================================================
-- Today, creating a session means filling out the full recurrence form
-- (RRuleBuilder) from scratch every single time — even for a schedule group
-- that runs the same handful of activities every week (e.g. "Water Walking",
-- "Adult Lengths", "Family Splash"). Session Templates let staff define each
-- recurring activity ONCE — its name, a color for visual scheduling, a
-- default duration, and a usual space — then reuse it repeatedly when
-- building out a schedule (e.g. drag-and-drop onto a space/day).
--
-- Templates are a presentation + defaults layer ONLY. Governance fields that
-- must stay consistent across every session in a schedule group — cost,
-- age_group, skill_level, sport_category, activity_type — deliberately stay
-- on schedule_groups and are not duplicated here, so changing a price can
-- never require hunting down N templates that silently drifted out of sync.
--
-- sessions.template_id is nullable and ON DELETE SET NULL: a session created
-- from a template is a fully independent row from that point on (the
-- template only supplied initial defaults), and archiving/deleting a
-- template must never cascade-delete sessions that already exist. All
-- existing manual/imported sessions have no template and keep
-- working exactly as before this migration.
-- =============================================================================

CREATE TABLE session_templates (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_group_id         UUID NOT NULL REFERENCES schedule_groups(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  -- Hex color (e.g. "#3B82F6") chosen via a color picker in the template
  -- form. NULL falls back to the sportColors.ts derivation from the parent
  -- schedule group's sport_category, same fallback pattern used everywhere
  -- else sport-based coloring already happens.
  color                     TEXT,
  default_duration_minutes  INTEGER NOT NULL CHECK (default_duration_minutes > 0),
  -- Usual space this activity runs in. Nullable — some activities (e.g. a
  -- roaming instructor-led class) have no fixed space.
  default_space_id          UUID REFERENCES spaces(id) ON DELETE SET NULL,
  display_order             INTEGER NOT NULL DEFAULT 0,
  -- Soft-delete/archive, same convention as sessions.is_active. Archiving a
  -- template removes it from the builder's palette without touching any
  -- session already placed from it (see template_id FK note above).
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE session_templates ENABLE ROW LEVEL SECURITY;

-- Deliberately no public-read policy: unlike spaces/departments/schedule_groups,
-- templates are a purely internal staff-authoring construct never rendered on
-- the public widget (only placed sessions are). This is intentional, not an
-- oversight — do not add a "public_read" policy here by reflex.
CREATE POLICY "session_templates_members_crud"
  ON session_templates FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "session_templates_superadmin_all"
  ON session_templates FOR ALL
  USING (public.is_superadmin());

CREATE INDEX idx_session_templates_schedule_group_id ON session_templates (schedule_group_id);
CREATE INDEX idx_session_templates_org_id ON session_templates (org_id);

-- =============================================================================
-- sessions.template_id — optional link back to the template a session was
-- created from. See header note above for the ON DELETE SET NULL rationale.
-- =============================================================================
ALTER TABLE sessions
  ADD COLUMN template_id UUID REFERENCES session_templates(id) ON DELETE SET NULL;

CREATE INDEX idx_sessions_template_id ON sessions (template_id);
