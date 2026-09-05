-- =============================================================================
-- Migration 044: Visitor-facing schedule filters
-- =============================================================================
-- Until now the only thing a visitor could narrow a schedule by was the
-- org-defined schedule switcher (widget_config_scopes, migration 043) — a
-- fixed list of facility/department/schedule entries staff configure by hand.
-- That answers "which schedule", not "when can I actually come", which is the
-- question someone reading a drop-in schedule is really asking: they want
-- Water Walking, or a Tuesday, or something after work.
--
-- enabled_filters is the org's choice of which of those general filters the
-- widget offers. The filtering itself is client-side over the sessions the
-- schedule has already loaded for the week in view — no new query shape, no
-- new API — so this column exists purely to say what UI to render.
--
-- Keys:
--   search    free-text across activity, schedule, space and location
--   activity  the session's template name (e.g. "Water Walking"), falling
--             back to its schedule group's name — the same string the
--             schedule views print on each session
--   day       day of the week
--   time      morning / afternoon / evening bands
--   space     which pool, court, studio or room
--   age       the schedule group's age_group, where set
--   week      jump straight to a given week instead of paging through
--
-- Default is the four that apply to essentially every drop-in schedule.
-- `space` and `age` are off by default because they are only meaningful for
-- orgs that actually fill those fields in, and an empty filter is worse than
-- no filter. A widget renders a control only when the loaded sessions offer
-- two or more distinct values for it, so an org enabling all seven never gets
-- a bar full of single-option dropdowns.
--
-- Existing rows take the default, which does change what already-embedded
-- widgets show. That is deliberate at this stage (pre-launch, and the filters
-- are strictly additive to a visitor's ability to read the schedule); an org
-- that wants the old bare schedule can clear the list from the widget page.
-- =============================================================================

ALTER TABLE widget_configs
  ADD COLUMN enabled_filters TEXT[] NOT NULL DEFAULT ARRAY['search', 'activity', 'day', 'time'];

-- Unknown keys would render as nothing and be invisible to debug, so they are
-- rejected at the boundary as well as in the route's zod schema. An empty
-- array is valid and means "no filter bar" — unlike allowed_templates, where
-- an empty set would leave the widget with nothing to render at all.
ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_enabled_filters_check
  CHECK (enabled_filters <@ ARRAY['search', 'activity', 'day', 'time', 'space', 'age', 'week']);

COMMENT ON COLUMN widget_configs.enabled_filters IS
  'Which visitor-facing schedule filters the widget/public page renders. Applied client-side over the loaded week; see src/lib/schedule/sessionFilters.ts.';
