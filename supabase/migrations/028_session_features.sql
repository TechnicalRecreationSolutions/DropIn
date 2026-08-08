-- =============================================================================
-- Migration 028: Event toggle, brochure toggle, and the shared feature payload
-- =============================================================================
-- A recreation org publishes the same handful of sessions in two places that
-- Dropin could not previously produce: a "what's happening" event calendar
-- (the month-at-a-glance sheet that gets printed and taped to a wall) and a
-- seasonal brochure. Both are already in the database as sessions; what's
-- missing is a way to say "this one is special" and somewhere to put the copy
-- that goes with it.
--
-- DESIGN DECISIONS (and the alternatives rejected)
--
-- 1. A flag on sessions, not a separate `events` table.
--    An event IS a session: it happens at a time, in a space, in a facility,
--    and it can be cancelled or moved. A parallel events table would have to
--    duplicate rrule/dtstart/timezone/valid_from, the RLS shape, the
--    session_spaces join, session_exceptions, and the whole expansion
--    pipeline — and would then drift from it. `is_event` is a lens on a
--    session, not a different kind of object.
--
-- 2. Two flags, one payload.
--    `is_event` and `in_brochure` are separate booleans because they are
--    separate publishing decisions: a weekly Family Swim belongs in the
--    brochure but would swamp an events calendar, and a one-off staff training
--    day belongs on neither. But the *content* they need is identical — title,
--    description, image, link — so it lives once, in session_features, and
--    both channels read it. Duplicating those columns per channel is how the
--    brochure ends up with a different name for an event than the calendar.
--
-- 3. A 1:1 sidecar rather than six more columns on `sessions`.
--    The payload is sparse (a small minority of sessions are ever featured)
--    and `sessions` is the hottest table in the app — every schedule view
--    expands it. Keeping the recurrence row lean matters more than saving a
--    join that only the two feature surfaces pay for.
--
--    Consequence worth stating: the flags are on `sessions` and the copy is in
--    `session_features`, so turning a toggle OFF does not delete the copy.
--    That is deliberate. Staff who un-feature an event in March and re-feature
--    it in October must get their description and image back, not a blank form.
--
-- 4. event_category is free text, not a CHECK constraint.
--    Every org names its own categories ("Aquatics Feature", "PD Day",
--    "Seniors"), the same reasoning that made `departments` org-defined rather
--    than a platform taxonomy (009). The visual weight is carried by
--    accent_color, which is structured; the category is a label. A fixed
--    enum here would need a migration every time an org invented a word.
--
-- 5. Feature editing is member-writable, matching sessions.
--    Migration 024 drew the line at "structural" (owner/admin) vs "schedule
--    editing" (any member), and left sessions, session_exceptions and
--    session_spaces member-writable. Writing the blurb for an event is
--    schedule content by that definition, not structure, so session_features
--    follows sessions rather than facilities.
--
-- Rollback: supabase/rollbacks/028_session_features.sql
-- =============================================================================

-- =============================================================================
-- The two toggles
-- =============================================================================
ALTER TABLE sessions
  -- Show this session on the event calendar ("what's happening in the building").
  ADD COLUMN is_event BOOLEAN NOT NULL DEFAULT FALSE,
  -- Make this session a candidate for a season's brochure. Candidacy, not
  -- membership: the brochure editor pulls candidates explicitly, so a season
  -- rolling over changes what is *suggested* and never what a human already
  -- assembled. (The brochure tables themselves land in a later migration.)
  ADD COLUMN in_brochure BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial indexes: featured sessions are a small minority of the table, and
-- FALSE is never the thing being searched for — the calendar asks for events,
-- nobody asks for non-events.
CREATE INDEX idx_sessions_is_event ON sessions (org_id) WHERE is_event = TRUE;
CREATE INDEX idx_sessions_in_brochure ON sessions (org_id) WHERE in_brochure = TRUE;

-- =============================================================================
-- SESSION FEATURES — the shared payload behind both toggles
-- =============================================================================
CREATE TABLE session_features (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE, not just an FK: exactly one feature record per session. The
  -- content is about the session itself, so a second row could only ever be a
  -- conflicting answer to the same question.
  session_id    UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  -- Denormalized for a flat org-scoped RLS check, matching session_spaces,
  -- session_exceptions, space_hotspots and map_context_elements.
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Overrides the schedule group's name on feature surfaces only. NULL means
  -- "use the schedule group's name" — the common case for a recurring session
  -- that's simply being highlighted rather than renamed.
  title         TEXT,
  -- One line, for a calendar cell. Kept separate from description because a
  -- month grid cell cannot show a paragraph and truncating prose mid-sentence
  -- reads worse than writing a short line on purpose.
  summary       TEXT,
  -- Long copy, for the brochure entry and the event detail sheet.
  description   TEXT,
  image_url     TEXT,
  -- The "hardcoded link" an org wants on a brochure/event entry: registration,
  -- a PDF, their own site. Free-form by design; validated as http(s) in the
  -- API layer rather than by a CHECK, so a bad paste is a 400 with a message
  -- instead of a constraint violation.
  link_url      TEXT,
  link_label    TEXT,

  -- Org-defined label (see decision 4). Drives grouping and the legend.
  event_category TEXT,
  -- Hex colour (e.g. "#B4472A"), same convention as session_templates.color.
  -- NULL falls back to the template colour, then to the sportColors.ts
  -- derivation — the fallback chain that already exists in sessionCardColor.ts.
  accent_color  TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE session_features ENABLE ROW LEVEL SECURITY;

-- Public read mirrors session_spaces (020) and exceptions_public_read (011)
-- exactly: readable directly for org members and superadmins, and for anyone
-- else ONLY through an EXISTS join back to the owning session's own
-- active/published gating. Never a blanket USING (TRUE) — that would let an
-- anonymous caller read the promotional copy and images for events attached to
-- schedule groups the org has not published yet.
CREATE POLICY "session_features_public_read"
  ON session_features FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_features.session_id
        AND s.is_active = TRUE
        AND sg.is_published = TRUE
    )
  );

-- Member-writable, matching sessions — see decision 5.
CREATE POLICY "session_features_members_crud"
  ON session_features FOR ALL
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

CREATE POLICY "session_features_superadmin_all"
  ON session_features FOR ALL
  USING (public.is_superadmin());

-- The calendar joins features to sessions, never the other way round.
CREATE INDEX idx_session_features_org_id ON session_features (org_id);
