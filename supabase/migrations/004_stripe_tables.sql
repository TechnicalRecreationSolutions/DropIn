-- =============================================================================
-- Migration 004: Stripe / Billing Tables
-- =============================================================================
-- Tracks org subscriptions synced from Stripe via webhook.
--
-- IMPORTANT: plan_tier is ALWAYS read from this table — never from a JWT claim
-- or client-supplied value. It is only updated by the Stripe webhook handler
-- using the service role client (bypasses RLS intentionally).
-- =============================================================================

CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT NOT NULL UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  plan_tier               TEXT NOT NULL DEFAULT 'free'
                          CHECK (plan_tier IN ('free', 'pro', 'enterprise')),
  -- Mirrors Stripe subscription status values
  status                  TEXT NOT NULL DEFAULT 'active',
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Org members can view their own subscription
CREATE POLICY "subscriptions_members_read"
  ON subscriptions FOR SELECT
  USING (org_id = ANY(auth.user_org_ids()) OR auth.is_superadmin());

-- Writes come exclusively from the Stripe webhook handler (service role — bypasses RLS)
-- No application-level INSERT/UPDATE policy is defined here intentionally.

-- Idempotency table: prevents double-processing of Stripe webhook events.
-- The webhook handler inserts by event_id before processing; duplicate deliveries
-- from Stripe are silently ignored.
CREATE TABLE stripe_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    TEXT NOT NULL UNIQUE,   -- Stripe event ID (e.g. "evt_1abc...")
  event_type  TEXT NOT NULL,
  processed   BOOLEAN NOT NULL DEFAULT FALSE,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- Only service role can access stripe_events (no application-level policies)
