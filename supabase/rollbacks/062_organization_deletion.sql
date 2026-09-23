-- Rollback for 062_organization_deletion.sql
--
-- Drops the function. Nothing else was created, and nothing was altered — the
-- migration adds no column, no policy and no trigger, so removing the function
-- returns the schema exactly to its 061 state.
--
-- Anything it already deleted is gone; a rollback cannot restore a cascade.

DROP FUNCTION IF EXISTS public.delete_organization(UUID, TEXT);
