-- =============================================================================
-- ROLLBACK for Migration 047
-- =============================================================================
-- Drops both default columns from session_templates.
--
-- Safe in a way 046's rollback is not: nothing but the create dialog's initial
-- values is lost. Sessions already placed keep their own occupancy_kind and
-- disclosure (they were copied at placement, not referenced), and no holder
-- names live here.
--
-- The application code must be reverted alongside this — the template form
-- posts both fields, and the command centre reads them to seed
-- CreateSessionDialog. They will error once these are gone, not silently
-- degrade.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

ALTER TABLE session_templates
  DROP COLUMN IF EXISTS occupancy_kind,
  DROP COLUMN IF EXISTS disclosure;
