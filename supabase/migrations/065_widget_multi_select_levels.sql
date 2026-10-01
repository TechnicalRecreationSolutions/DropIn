-- =============================================================================
-- 065: let visitors tick several facilities / departments / schedules
-- =============================================================================
--
-- The widget's switcher (Facility / Department / Schedule) takes one pick per
-- level. multi_select_levels names the levels where the org lets a visitor
-- tick several at once — e.g. two pools side by side, or lane swim and
-- aquafit together. Nothing ticked at a level still means "All …" there.
--
-- Default empty: every existing embed keeps one-at-a-time until the org opts
-- in from step 3 of the widget studio. What a pick means — and that it can
-- never reach outside the schedules the org configured — is
-- src/lib/schedule/scopeSelection.ts.
--
-- The embed reads widget_configs with `select *` and treats a missing column
-- as the default, so the code ships safely ahead of this migration.
-- =============================================================================

ALTER TABLE widget_configs
  ADD COLUMN multi_select_levels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Unknown values would render as nothing and be invisible to debug, so they
-- are rejected here as well as in the route's zod schema.
ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_multi_select_levels_check
  CHECK (multi_select_levels <@ ARRAY['facility', 'department', 'schedule']);

COMMENT ON COLUMN widget_configs.multi_select_levels IS
  'Switcher levels (facility, department, schedule) where widget visitors may tick several at once. Empty = one at a time everywhere.';
