-- =============================================================================
-- Migration 007: Add stripe_customer_id to organizations
-- =============================================================================
-- The create-checkout API route creates a Stripe customer on first checkout
-- and persists the ID here so subsequent checkouts and portal sessions can
-- reuse the same Stripe customer without creating duplicates.
-- =============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
