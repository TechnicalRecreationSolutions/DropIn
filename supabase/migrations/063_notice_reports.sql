-- =============================================================================
-- Migration 063: Staff can report a problem, even when they cannot post one
-- =============================================================================
-- 060 gave each organization a switch, `aux_can_post_notices`, deciding whether
-- a lifeguard may publish "Pool closed — contamination" to patrons. It
-- defaults off, and with it off the guard who found the contamination had
-- exactly one option in the product: read a sentence telling them to ask a
-- manager. No record, no alert, nothing a manager would see on their next
-- glance at the Overview. The phone call happened outside the app, and so did
-- the closure.
--
-- This adds the missing middle: a REPORT. An aux staffer may always file one
-- for a facility in their scope. It is an ordinary `facility_notices` row with
-- two properties fixed:
--
--   is_published = FALSE   patrons never see it (060's public read policy
--                          already requires is_published)
--   needs_review = TRUE    it is waiting for someone who CAN publish
--
-- A manager or coordinator then either publishes it as written (one tap,
-- `is_published = true, needs_review = false`) or dismisses it (`ends_at =
-- now(), needs_review = false`). Both go through 060's existing write policy,
-- which is unchanged — the switch still decides who may publish, and this
-- migration widens nothing about that.
--
--
-- WHY A COLUMN, NOT `NOT is_published`
--
-- An unpublished notice already means something: "Save as internal" in the
-- composer, which 060 describes as an organization keeping a record of a
-- thing patrons were never told about. Treating every unpublished row as a
-- report would turn each deliberate internal note into a permanent red alert
-- on the Overview. `needs_review` is the one bit that distinguishes "someone
-- is waiting on you" from "someone wrote this down".
--
-- A published notice cannot be waiting for review, so that is a CHECK rather
-- than a convention every route has to remember.
--
--
-- WHY INSERT-ONLY FOR AUX
--
-- The report policy below grants INSERT and nothing else. The staffer cannot
-- edit, publish, withdraw or delete what they filed — those remain
-- `can_write_notice()` and therefore the switch. A mistaken report costs a
-- manager one "Dismiss", which is cheaper than a second authority path to get
-- wrong.
-- =============================================================================

ALTER TABLE facility_notices
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN facility_notices.needs_review IS
  'TRUE while a staff report is waiting for someone who may publish it '
  '(migration 063). Never true on a published notice. Distinguishes a report '
  'from a deliberate internal note, which is also unpublished.';

ALTER TABLE facility_notices
  DROP CONSTRAINT IF EXISTS facility_notices_review_unpublished;
ALTER TABLE facility_notices
  ADD CONSTRAINT facility_notices_review_unpublished
  CHECK (NOT (needs_review AND is_published));

-- The Overview asks "how many reports are waiting in this organization" on
-- every load. Partial, because a waiting report is rare and short-lived.
CREATE INDEX IF NOT EXISTS idx_facility_notices_needs_review
  ON facility_notices (org_id, facility_id)
  WHERE needs_review;


-- -----------------------------------------------------------------------------
-- The report policy
-- -----------------------------------------------------------------------------
-- Permissive policies OR together, so this ADDS to 060's
-- `facility_notices_write` for the INSERT command only. Every clause is
-- load-bearing:
--
--   org_role = 'aux'             owners, managers and coordinators already
--                                write through can_write_notice(); a second
--                                path for them would be a second thing to audit
--   facility in scope            the same facility union 060 uses
--   org_id is the facility's org without it a staffer could file a row whose
--                                org_id names another organization and have it
--                                surface on that organization's Overview
--   NOT is_published             the whole point
--   needs_review                 a report, not an internal note — so it cannot
--                                be used to leave silent rows either
--   created_by = auth.uid()      the reporter is on the record and cannot be
--                                forged as someone else
--   ends_at IS NULL              a report is open until someone closes it

DROP POLICY IF EXISTS "facility_notices_aux_report" ON facility_notices;
CREATE POLICY "facility_notices_aux_report"
  ON facility_notices FOR INSERT
  WITH CHECK (
    public.org_role(org_id) = 'aux'
    AND facility_id = ANY(public.user_scope_facility_ids())
    AND EXISTS (
      SELECT 1 FROM facilities f
       WHERE f.id = facility_notices.facility_id
         AND f.org_id = facility_notices.org_id
    )
    AND NOT is_published
    AND needs_review
    AND created_by = auth.uid()
    AND ends_at IS NULL
  );


-- =============================================================================
-- VERIFYING
-- =============================================================================
--   node --experimental-strip-types scripts/verify/verify-be.mjs
--
-- Asserted against PostgREST directly, as the staffer, with the switch OFF:
--   * a report (unpublished, needs_review, own created_by) is accepted
--     — the positive control;
--   * the same row with is_published = true is refused;
--   * needs_review = false (a silent internal note) is refused;
--   * a facility outside the staffer's scope is refused;
--   * created_by naming someone else is refused;
--   * the staffer cannot UPDATE or DELETE their own report;
--   * an anonymous client cannot see it;
--   * a manager can publish it, and the CHECK refuses published + needs_review.
-- =============================================================================
