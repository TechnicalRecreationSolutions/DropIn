-- =============================================================================
-- Migration 027: Seasons
-- =============================================================================
-- Dropin can describe what happens in a building this *week*. It has no way to
-- describe what happens this *season* — the period real recreation orgs plan,
-- schedule, and publish in ("Fall 2026 runs Sep 8 to Dec 20"). Sessions carry
-- valid_from/valid_until, but those are per-session dates with no shared name,
-- so nothing can ask "show me Fall" or "is Fall ready".
--
-- A season is an org-defined named date range. It is the backbone the event
-- calendar, the seasonal brochure, and the planning/task tooling are all built
-- on, so it lands first and alone.
--
-- DESIGN DECISIONS (and the alternatives rejected)
--
-- 1. Org-level, not facility-level.
--    An org publishes ONE seasonal brochure and one events board across all of
--    its buildings — centralizing across facilities is the entire point. A
--    facility that wants its own view of a season gets it by *filtering* that
--    season, not by owning a separate season row. A facility_id column here
--    would silently fork "Fall 2026" into four incompatible Falls.
--
-- 2. Seasons may overlap, deliberately. NO exclusion constraint.
--    Summer camps genuinely straddle the tail of a spring session, and a
--    year-long "2026-27 Aquatics" period can legitimately contain Fall and
--    Winter. A tsrange EXCLUDE constraint was considered and rejected: it would
--    reject data that is correct in the real world.
--
--    The cost of allowing overlap is that "the current season" is NOT derivable
--    from now() alone. That resolution rule lives in exactly one place —
--    src/lib/seasons/current.ts — and must not be re-derived inline at call
--    sites. See that file's header for the rule.
--
-- 3. status, not is_published.
--    Everything else in this schema publishes with is_published, and this
--    deliberately does not, because a season has three meaningfully different
--    states rather than two: 'planning' (staff are building it; invisible to
--    the public), 'active' (published — brochures and calendars may reference
--    it), and 'archived' (over, but its public URLs must keep resolving so a
--    printed brochure link from last year doesn't 404). Collapsing archived
--    into "unpublished" would break those links; collapsing it into
--    "published" would clutter every season picker forever.
--
--    Public read below therefore gates on status <> 'planning' rather than on
--    an is_published boolean. That is the same *shape* of gate as everywhere
--    else, just with three states.
--
-- 4. sessions.season_id is nullable and explicit — not inferred from dates.
--    Season membership COULD be computed by overlapping valid_from/valid_until
--    against the season range. That inference is a fine default to offer in the
--    UI, but it cannot be the truth: staff need to be able to say "this belongs
--    to Fall" about something whose dates spill a week either side, and a
--    brochure built on inference would silently rewrite itself when someone
--    extends a session's end date.
--
--    ON DELETE SET NULL: deleting a season must never cascade-delete the
--    sessions that ran during it. Every existing session keeps season_id NULL
--    and behaves exactly as it does today — the same
--    preserve-existing-behaviour default that 009, 013 and 014 each used.
--
-- Rollback: supabase/rollbacks/027_seasons.sql
-- =============================================================================

CREATE TABLE seasons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  description   TEXT,
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,
  -- planning: staff are building it out; never visible to the public
  -- active:   published; brochures and event calendars may reference it
  -- archived: finished, but still publicly resolvable so old links survive
  status        TEXT NOT NULL DEFAULT 'planning'
                CHECK (status IN ('planning', 'active', 'archived')),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A season with no duration is always a data-entry mistake. Single-day
  -- seasons are legal (ends_on = starts_on) — a one-day festival is a real
  -- thing an org might want a brochure for.
  CONSTRAINT seasons_dates_ordered CHECK (ends_on >= starts_on),
  UNIQUE (org_id, slug)
);

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

-- Public read is narrow by construction (migration 026's rule): anonymous
-- callers see only seasons the org has actually published, and every column on
-- this table is safe to expose — name, slug, dates, description are exactly
-- what a public brochure URL renders. Members see their own org's seasons in
-- every state, which is also what gives members SELECT after the managers-only
-- write policy below (permissive policies are OR'd — see 024).
CREATE POLICY "seasons_public_read_published"
  ON seasons FOR SELECT
  USING (
    status <> 'planning'
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

-- Creating and dating a season is structural planning, not schedule editing,
-- so it follows the facilities/departments/schedule_groups rule from 024
-- rather than the member-writable rule that sessions get.
CREATE POLICY "seasons_managers_crud"
  ON seasons FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

CREATE POLICY "seasons_superadmin_all"
  ON seasons FOR ALL
  USING (public.is_superadmin());

-- Season pickers list an org's seasons newest-first; the public brochure and
-- event calendar resolve one by (org, slug), which the UNIQUE above indexes.
CREATE INDEX idx_seasons_org_starts_on ON seasons (org_id, starts_on DESC);

-- =============================================================================
-- sessions.season_id — see decision 4 above.
-- =============================================================================
ALTER TABLE sessions
  ADD COLUMN season_id UUID REFERENCES seasons(id) ON DELETE SET NULL;

-- Partial: the overwhelming majority of rows are NULL (every session that
-- predates this migration, plus anything an org never assigns), and NULLs are
-- never the thing being filtered for — "show me Fall's sessions" is always an
-- equality match on a real id.
CREATE INDEX idx_sessions_season_id ON sessions (season_id) WHERE season_id IS NOT NULL;

-- Cross-table consistency (the season belongs to the same org as the session)
-- is validated at the API route layer, consistent with how facility/department
-- ownership is checked in src/app/api rather than by a DB constraint.
