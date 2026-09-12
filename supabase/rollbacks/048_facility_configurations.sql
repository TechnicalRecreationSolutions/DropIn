-- =============================================================================
-- ROLLBACK for Migration 048
-- =============================================================================
-- Drops spaces.configuration_id first, then the table it references.
--
-- What is lost: which configuration each space belonged to. The spaces
-- themselves, every session attached to them, and every holder name in
-- session_internal are untouched — configuration_id is a label on a lane, not
-- a container for one. Re-running migration 048 afterwards gives every space
-- back as NULL ("in every configuration"), which is where they all started.
--
-- The application code must be reverted alongside this. /api/spaces accepts
-- configuration_id, /api/sessions/expand embeds the configuration name through
-- session_spaces → spaces → facility_configurations, and the lane pickers group
-- by it. Those will error once these are gone, not silently degrade.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP INDEX IF EXISTS idx_spaces_configuration_id;

ALTER TABLE spaces
  DROP COLUMN IF EXISTS configuration_id;

DROP TABLE IF EXISTS facility_configurations;
