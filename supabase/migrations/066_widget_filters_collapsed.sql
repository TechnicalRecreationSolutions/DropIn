-- =============================================================================
-- 066: whether the widget's filter section starts collapsed
-- =============================================================================
--
-- The visitor filters (Search / Activity / Day / Time…, migration 044) sit in a
-- section that visitors can now fold away behind a "Filters" toggle. This is
-- the org's choice of how it *starts*: open (every control visible) or
-- collapsed (one "Filters" row, which keeps a long embed short — useful on a
-- phone, or for a centre whose visitors mostly just scan the week).
--
-- Default false: every existing embed keeps its filters open, which is how
-- they rendered before this column. Set from step 3 of the widget studio, and
-- honoured by the public facility page as well as the embed.
--
-- The embed reads widget_configs with `select *` and treats a missing column
-- as the default, so the code ships safely ahead of this migration.
-- =============================================================================

ALTER TABLE widget_configs
  ADD COLUMN filters_collapsed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN widget_configs.filters_collapsed IS
  'Whether the visitor filter section starts collapsed behind its "Filters" toggle. Visitors can open or close it either way.';
