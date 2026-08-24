-- =============================================================================
-- ROLLBACK for Migration 039
-- =============================================================================
-- Drops the dismissals table and its policies/indexes (CASCADE-less plain
-- DROP — nothing else references this table). The Overview stat card,
-- /dashboard/conflicts page, and /api/conflicts routes must be reverted
-- alongside this — they will error once this table is gone, not silently
-- degrade.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP TABLE IF EXISTS session_conflict_dismissals;
