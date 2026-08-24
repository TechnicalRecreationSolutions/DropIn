-- =============================================================================
-- Migration 039: Session Conflict Dismissals
-- =============================================================================
-- Closes out docs/RESUME-layout-rework.md's "Conflicts as a persisted,
-- aggregatable count" section: the Overview's "Conflicts" stat card and a new
-- /dashboard/conflicts manager page. See src/lib/sessions/conflicts.ts's
-- findOrgConflicts() for the detection side — this migration only adds the
-- one thing detection alone can't provide: a place to remember "we know
-- about this double-booking and it's fine."
--
-- DESIGN DECISIONS
--
-- 1. On-demand detection, not a persisted conflicts table. findOrgConflicts()
--    re-runs the same pairwise RRULE-overlap check the write-time gate
--    (findSessionConflict()) already uses, scoped to the whole org, every
--    time the Overview or the manager page is opened. No cron, no trigger,
--    no staleness window — at the cost of paying the scan on every load.
--    Acceptable for a tool built for one centre's schedule, not a
--    multi-tenant marketplace (see docs' NOT_A_MARKETPLACE decision).
--
-- 2. Only the dismissal is persisted, not the conflict itself. A conflict is
--    entirely derived (two active sessions, shared space, overlapping
--    occurrence) and needs no storage of its own. But "staff looked at this
--    pair and confirmed it's intentional" is a fact with no other home — it
--    has to survive the next scan finding the exact same pair again. Rows
--    here are keyed on the *session pair*, not a specific occurrence date:
--    a recurring double-booking recurs on every occurrence, and re-asking
--    "still fine?" for each date would be noise, not safety.
--
-- 3. session_a_id < session_b_id (enforced by CHECK, not just convention) is
--    what makes the pair a single canonical row instead of two. The
--    application layer normalizes the order before every insert; the CHECK
--    is what stops a bug from ever writing the reverse pair and silently
--    duplicating a dismissal that findOrgConflicts()'s lookup (also ordered
--    low-id-first) would then miss.
--
-- 4. Member-writable (FOR ALL org members), matching sessions,
--    session_exceptions and session_spaces (002_rls_policies.sql) rather
--    than org_can_manage()'s owner/admin gate. Dismissing a conflict is
--    "schedule editing" in the same sense drag-to-reschedule is — see
--    /api/sessions/[sessionId]/route.ts's header comment and SECURITY.md →
--    L2 for why that split exists.
--
-- Rollback: supabase/rollbacks/039_session_conflict_dismissals.sql
-- =============================================================================

CREATE TABLE session_conflict_dismissals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_a_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  session_b_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- Optional staff-entered reason ("they share the gym floor on purpose").
  note         TEXT,
  dismissed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_conflict_dismissals_ordered CHECK (session_a_id < session_b_id)
);

-- One dismissal per pair — a second dismiss of the same pair is an upsert
-- (see POST /api/conflicts/dismiss), not a second row.
CREATE UNIQUE INDEX session_conflict_dismissals_pair_idx
  ON session_conflict_dismissals (session_a_id, session_b_id);
CREATE INDEX session_conflict_dismissals_org_idx
  ON session_conflict_dismissals (org_id);

ALTER TABLE session_conflict_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "session_conflict_dismissals_members_crud"
  ON session_conflict_dismissals FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "session_conflict_dismissals_superadmin_all"
  ON session_conflict_dismissals FOR ALL
  USING (public.is_superadmin());
