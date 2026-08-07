-- =============================================================================
-- ROLLBACK for Migration 023
-- =============================================================================
-- ⚠️  THIS RESTORES A CRITICAL VULNERABILITY.
--
-- Re-creating this policy makes every pending staff invitation — including its
-- redemption `token` and the invitee's `email` — readable by any anonymous
-- caller holding the publishable key.
--
-- There is no legitimate reason to run this. It exists only so the change is
-- formally reversible. If an accept flow needs invitation lookup, use the
-- SECURITY DEFINER function documented in migration 023 instead.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

CREATE POLICY "invitations_public_read_by_token"
  ON staff_invitations FOR SELECT
  USING (accepted_at IS NULL AND expires_at > NOW());
