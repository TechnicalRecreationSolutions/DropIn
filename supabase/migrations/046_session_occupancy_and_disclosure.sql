-- =============================================================================
-- Migration 046: Occupancy Kind, Disclosure, and the Internal Sidecar
-- =============================================================================
-- Stage 1 of docs/PLAN-internal-view.md. Staff need to record who actually
-- holds a space — the swim club in Lanes 1-3, the camp, the rental — so the
-- lifeguard on deck knows what setup it needs, WITHOUT publishing the renter's
-- name to patrons. Patrons must still learn that the water is gone.
--
-- Two orthogonal columns plus one sidecar table. Nothing here changes the
-- behaviour of a single existing row: every default reproduces today's app.
--
-- DESIGN DECISIONS
--
-- 1. Two axes, not one. `occupancy_kind` says what a booking does to the
--    space; `disclosure` says who may know its name. Conflating them was the
--    mistake in every earlier sketch of this feature, and it breaks two real
--    cases immediately: swim lessons are exclusive but SHOULD be advertised,
--    and a maintenance closure is exclusive but "closed for maintenance" is
--    exactly what a patron needs to read. Kind supplies a *default*
--    disclosure in the UI; it does not determine it.
--
-- 2. Residual vs exclusive is DERIVED from occupancy_kind, not a third column.
--    'drop_in' claims whatever is not exclusively claimed; everything else
--    takes its spaces outright. A per-session override ("Family Swim gets
--    exactly lanes 5-6 and no more") is a plausible future case and is
--    deliberately not built speculatively — widen this when a customer
--    produces one. See src/lib/sessions/conflicts.ts, which reads the kind.
--
-- 3. occupancy_kind is NOT schedule_groups.activity_type. That column
--    (migration 011) is a *patron* descriptor — "can I just show up?" — with
--    values drop_in/registered/open_gym, and it lives on the group, shared by
--    every session under it. This one is a *space* descriptor and lives on the
--    session, because one "Rentals" schedule group holds many different
--    renters' bookings. The two share the string 'drop_in' and mean different
--    things by it. Do not merge them.
--
-- 4. The renter's name does NOT go on `sessions`. It goes in session_internal,
--    which has no public-read policy at all. RLS is row-level, so a column on
--    a publicly-readable row ships to the public the moment it exists:
--    /api/sessions/expand does `select("*")` and is the single endpoint
--    serving patrons, the widget, the public facility page and the dashboard,
--    separated by RLS alone. A sidecar makes the redaction a property of the
--    database instead of a thing the API has to remember. The API also
--    substitutes a generic label for 'reserved' rows, but that is defence in
--    depth — this table is the defence.
--
-- 5. disclosure = 'internal' is gated in RLS; 'reserved' is not.
--    'internal' means the row itself must not reach the public, which is
--    exactly what a row policy expresses. 'reserved' means the row SHOULD
--    reach the public with its identity stripped — there is nothing row-level
--    about that, and hiding the row would defeat the entire point (patrons
--    would not learn the water is gone). So 'reserved' is an API-layer
--    projection over a publicly-readable row, and the only secret involved
--    lives in session_internal where anon cannot read it.
--
-- 6. is_active was NOT reused, though it is already a per-session public gate.
--    DELETE /api/sessions sets is_active = false as the soft-delete
--    (src/app/api/sessions/route.ts), and every staff read path filters
--    .eq("is_active", true). A session hidden that way would be invisible to
--    staff too, and indistinguishable from a deleted one. The gate exists; the
--    slot is taken.
--
-- 7. The two dependent policies are patched in the same migration.
--    sessions_public_read_active is not the only thing standing between anon
--    and an internal booking: exceptions_public_read and
--    session_spaces_public_read (both recreated in migration 033) join back to
--    `sessions` on their own and would keep serving an internal session's
--    space claims and cancellations — leaking which lanes are taken and when,
--    for a session anon cannot see. They are patched here rather than left for
--    a later migration to discover. NOTE session_features_public_read, named
--    as a fifth dependent in docs/OPTIONS-internal-view.md, no longer exists:
--    migration 036 dropped the table.
--
-- Rollback: supabase/rollbacks/046_session_occupancy_and_disclosure.sql
-- =============================================================================

ALTER TABLE sessions
  -- What this booking does to the space it claims. See decisions 2 and 3.
  ADD COLUMN occupancy_kind TEXT NOT NULL DEFAULT 'drop_in'
    CHECK (occupancy_kind IN ('drop_in', 'program', 'rental', 'closure')),
  -- Who may know its name. 'public' = today's behaviour for every existing row.
  ADD COLUMN disclosure TEXT NOT NULL DEFAULT 'public'
    CHECK (disclosure IN ('public', 'reserved', 'internal'));

COMMENT ON COLUMN sessions.occupancy_kind IS
  'Space semantics: drop_in is residual (claims what is not exclusively '
  'claimed), everything else is exclusive. Distinct from '
  'schedule_groups.activity_type, which is a patron-facing descriptor.';

COMMENT ON COLUMN sessions.disclosure IS
  'public = name published. reserved = block published, name withheld (the '
  'name lives in session_internal). internal = row withheld entirely, '
  'enforced by sessions_public_read_active below.';

-- =============================================================================
-- SESSION INTERNAL — staff-only sidecar. NO PUBLIC READ POLICY, EVER.
-- =============================================================================
-- 1:1 with sessions. Holds the two things patrons must never see: who holds
-- the space, and what setup it needs ("soft lane ropes, wave breakers, polo
-- nets" — the content of the hand-built Excel sheet this feature replaces).
--
-- Free text, not a structured equipment list: this replaces a spreadsheet
-- cell, not an inventory system. Per-occurrence variation (polo nets this
-- Tuesday but not next) belongs to session_exceptions and is deliberately
-- deferred.
--
-- Member-writable, matching sessions/session_spaces/session_exceptions
-- (002_rls_policies.sql) rather than org_can_manage()'s owner/admin gate —
-- recording who is in a lane is schedule editing, which `member` already means.
-- =============================================================================
CREATE TABLE session_internal (
  session_id  UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Who holds this space: "Island Swimming", "Westside Camps", "Lane rental — J. Okafor".
  holder_name TEXT,
  -- What the guard on deck needs to set up before it starts.
  setup_notes TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE session_internal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "session_internal_members_crud"
  ON session_internal FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "session_internal_superadmin_all"
  ON session_internal FOR ALL
  USING (public.is_superadmin());

-- Deliberately absent: any policy granting SELECT to anon or to a signed-in
-- user outside the org. Adding one defeats the entire purpose of this table
-- (decision 4). If a public surface ever needs something from here, project a
-- redacted value in the API instead.

CREATE INDEX idx_session_internal_org_id ON session_internal (org_id);

-- =============================================================================
-- POLICY PATCHES — three policies from migration 033 (decision 7)
-- =============================================================================
-- Same shape as 033 left them, plus `disclosure <> 'internal'`. Org members
-- keep bypassing via user_org_ids(), so staff still see every session.

DROP POLICY "sessions_public_read_active" ON sessions;
CREATE POLICY "sessions_public_read_active"
  ON sessions FOR SELECT
  USING (
    (
      is_active = TRUE
      AND disclosure <> 'internal'
      AND EXISTS (
        SELECT 1 FROM schedule_groups sg
        WHERE sg.id = sessions.schedule_group_id AND sg.status = 'published'
      )
    )
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

DROP POLICY "exceptions_public_read" ON session_exceptions;
CREATE POLICY "exceptions_public_read"
  ON session_exceptions FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_exceptions.session_id
      AND s.is_active = TRUE AND s.disclosure <> 'internal' AND sg.status = 'published'
    )
  );

DROP POLICY "session_spaces_public_read" ON session_spaces;
CREATE POLICY "session_spaces_public_read"
  ON session_spaces FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_spaces.session_id
      AND s.is_active = TRUE AND s.disclosure <> 'internal' AND sg.status = 'published'
    )
  );

-- No index on disclosure. It is a low-cardinality predicate evaluated per row
-- inside policies that already filter on is_active plus a schedule-group join;
-- the planner gains nothing from indexing it, and the existing
-- idx_sessions_schedule_group_id remains the useful one.
