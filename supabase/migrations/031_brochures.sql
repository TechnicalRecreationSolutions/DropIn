-- =============================================================================
-- Migration 031: Brochures — candidacy, membership, publication
-- =============================================================================
-- The second output of "one entry, many surfaces": a seasonal brochure built
-- from sessions and schedule groups the org already entered, rather than
-- retyped into a document.
--
-- THE HARD PART, AND THE MODEL THAT SOLVES IT
--
-- The question that kills a naive design is *when to stop pulling events*.
-- Summer's brochure must not silently grow fall's sessions the moment fall
-- starts, and last year's printed brochure must not change because someone
-- edited a session in it. A live query cannot express that — anything derived
-- from "sessions overlapping this season" rewrites itself under you.
--
-- So there are three distinct states, and they are distinct in the schema:
--
--   1. CANDIDACY is computed and stored nowhere. A session or schedule group is
--      a candidate for a season's brochure if its `in_brochure` flag is set and
--      its dates overlap the season. This is what the editor's "Suggested" rail
--      shows. Changing a season's dates changes what is *suggested* — nothing
--      more.
--
--   2. MEMBERSHIP is explicit and stored. "Pull candidates" materializes chosen
--      candidates into `brochure_entries`. From that moment the brochure is
--      something a human assembled, and no season boundary, flag change or
--      date edit can alter it.
--
--   3. PUBLICATION freezes. Entries carry their own copy, snapshotted at pull
--      time, so an entry is self-contained by construction. Editing the
--      underlying session afterwards cannot rewrite a brochure that has been
--      printed. The editor shows a "source has changed" hint with a one-click
--      re-pull; it never applies one silently.
--
-- DESIGN DECISIONS (and the alternatives rejected)
--
-- 1. Dismissed entries are tombstones, not deletions.
--
--    "Aqua Fit doesn't belong in the Fall brochure" must survive the next pull,
--    or every re-pull resurrects everything anyone ever removed. Deleting the
--    row cannot express that — the pull would find the candidate again and have
--    no memory of the decision. A `status = 'dismissed'` row occupies the slot
--    and the pull skips it.
--
--    This is also why staff must not have to un-flag `in_brochure` globally to
--    keep something out of one brochure: the flag is about the *program*, the
--    tombstone is about *this brochure*.
--
-- 2. `brochure_id` is denormalized onto entries, not reached through the section.
--
--    Both invariants that matter are brochure-wide, not section-wide: a source
--    may appear at most once per brochure, and a tombstone must be found
--    wherever it was dismissed from. Reaching brochure_id through section_id
--    would make both a join, and would make the UNIQUE constraints below
--    impossible to express.
--
-- 3. `section_id` is nullable with ON DELETE SET NULL.
--
--    Deleting a section must not delete the tombstones that lived in it —
--    that would silently resurrect dismissed candidates on the next pull, which
--    is the exact failure decision 1 exists to prevent. Included entries that
--    lose their section become "unfiled" and the editor surfaces them; nothing
--    is destroyed by reorganizing.
--
-- 4. Source FKs are ON DELETE SET NULL, never CASCADE.
--
--    An entry keeps its snapshot copy. Deleting the session behind a brochure
--    that has already been printed must leave the brochure intact — the entry
--    is the record of what was published, and cascading would rewrite history
--    to match the present. `source_type` stays as it was, so the editor can
--    still say "this came from a session that no longer exists".
--
-- 5. `schedule_groups.in_brochure`, not only sessions.
--
--    A brochure lists *programs* — "Lane Swim, Mon/Wed/Fri, $6" — at least as
--    often as one-off events, and schedule groups already carry a description,
--    cost, age group and photos. Both candidate types flow through one pull.
--
-- 6. Brochures are owner/admin; sections and entries are member-writable.
--
--    Migration 024's line: structural vs content. A brochure has a slug, a
--    publish state and a public URL — it is the same kind of object as a
--    schedule group, so creating and publishing one is a managing act.
--    Assembling what goes inside it is content authoring, like editing a
--    session, so a member can do the work without being able to publish it.
--
-- Rollback: supabase/rollbacks/031_brochures.sql
-- =============================================================================

-- =============================================================================
-- Candidacy flag on schedule groups (decision 5)
-- =============================================================================
ALTER TABLE schedule_groups
  ADD COLUMN in_brochure BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index, matching the ones 028 added for sessions: candidates are a
-- small minority and FALSE is never what anyone searches for.
CREATE INDEX idx_schedule_groups_in_brochure
  ON schedule_groups (org_id) WHERE in_brochure = TRUE;

-- =============================================================================
-- BROCHURES
-- =============================================================================
CREATE TABLE brochures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- A brochure is *of* a season. Deleting the season leaves the brochure
  -- standing, for the same reason 027 made sessions.season_id SET NULL: the
  -- artifact outlives the planning period it was built for.
  season_id         UUID REFERENCES seasons(id) ON DELETE SET NULL,
  -- NULL means org-wide, matching widget_configs' scoping convention.
  facility_id       UUID REFERENCES facilities(id) ON DELETE CASCADE,

  title             TEXT NOT NULL,
  subtitle          TEXT,
  slug              TEXT NOT NULL,
  cover_image_url   TEXT,
  intro_copy        TEXT,
  -- Falls back to the org's widget_configs.primary_color when NULL, the same
  -- chain OrgThemeProvider already uses.
  accent_color      TEXT,

  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published', 'archived')),
  published_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT brochures_slug_unique UNIQUE (org_id, slug)
);

CREATE INDEX idx_brochures_org_id ON brochures (org_id);
CREATE INDEX idx_brochures_season_id ON brochures (season_id);

-- =============================================================================
-- SECTIONS
-- =============================================================================
CREATE TABLE brochure_sections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brochure_id   UUID NOT NULL REFERENCES brochures(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  title         TEXT NOT NULL,
  blurb         TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  -- How entries inside this section are laid out. Deliberately a small fixed
  -- set rather than free text: each value is a real template in the renderer,
  -- and an unknown value would have nothing to render with.
  layout        TEXT NOT NULL DEFAULT 'list'
                  CHECK (layout IN ('list', 'grid', 'feature')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_brochure_sections_brochure_id
  ON brochure_sections (brochure_id, display_order);
CREATE INDEX idx_brochure_sections_org_id ON brochure_sections (org_id);

-- =============================================================================
-- ENTRIES
-- =============================================================================
CREATE TABLE brochure_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized deliberately — see decision 2.
  brochure_id        UUID NOT NULL REFERENCES brochures(id) ON DELETE CASCADE,
  -- Nullable so a deleted section cannot take tombstones with it (decision 3).
  section_id         UUID REFERENCES brochure_sections(id) ON DELETE SET NULL,
  org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  source_type        TEXT NOT NULL
                       CHECK (source_type IN ('session', 'schedule_group', 'custom')),
  session_id         UUID REFERENCES sessions(id) ON DELETE SET NULL,
  schedule_group_id  UUID REFERENCES schedule_groups(id) ON DELETE SET NULL,

  -- Snapshot at pull time, then freely edited (decision 4 / publication
  -- freezing). `title` is NOT NULL because an entry with no name is not a
  -- thing a brochure can print, and the pull always has one to copy.
  title              TEXT NOT NULL,
  description        TEXT,
  image_url          TEXT,
  link_url           TEXT,
  link_label         TEXT,

  status             TEXT NOT NULL DEFAULT 'included'
                       CHECK (status IN ('included', 'dismissed')),
  display_order      INTEGER NOT NULL DEFAULT 0,
  -- When the snapshot was taken. Compared against the source's updated_at to
  -- show "source has changed since pulled" — never to auto-apply.
  source_pulled_at   TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exactly one source FK for a derived entry; neither for a custom one.
  -- Without this, a row could claim source_type = 'session' with a
  -- schedule_group_id, and the re-pull comparison would read the wrong table.
  CONSTRAINT brochure_entries_source_shape CHECK (
    (source_type = 'session'        AND session_id IS NOT NULL AND schedule_group_id IS NULL)
    OR (source_type = 'schedule_group' AND schedule_group_id IS NOT NULL AND session_id IS NULL)
    OR (source_type = 'custom'      AND session_id IS NULL AND schedule_group_id IS NULL)
  )
);

-- One entry per source per brochure, including tombstones — this is what makes
-- a re-pull skip what was dismissed rather than adding it again. Partial so
-- that any number of 'custom' entries (both FKs NULL) may coexist.
CREATE UNIQUE INDEX idx_brochure_entries_unique_session
  ON brochure_entries (brochure_id, session_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_brochure_entries_unique_schedule_group
  ON brochure_entries (brochure_id, schedule_group_id) WHERE schedule_group_id IS NOT NULL;

CREATE INDEX idx_brochure_entries_section
  ON brochure_entries (section_id, display_order);
CREATE INDEX idx_brochure_entries_brochure ON brochure_entries (brochure_id);
CREATE INDEX idx_brochure_entries_org_id ON brochure_entries (org_id);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE brochures         ENABLE ROW LEVEL SECURITY;
ALTER TABLE brochure_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE brochure_entries  ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Read. Publish-gated for the public, never USING (TRUE) — migration 026.
-- -----------------------------------------------------------------------------
CREATE POLICY "brochures_public_read"
  ON brochures FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR status = 'published'
  );

-- Sections and entries gate through the parent brochure's publish state rather
-- than carrying their own. A section is not independently publishable, and a
-- second flag would be a second thing to get wrong.
CREATE POLICY "brochure_sections_public_read"
  ON brochure_sections FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM brochures b
       WHERE b.id = brochure_sections.brochure_id AND b.status = 'published'
    )
  );

-- Dismissed entries are an editorial decision, not content: they must never
-- reach a public reader even inside a published brochure.
CREATE POLICY "brochure_entries_public_read"
  ON brochure_entries FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR (
      status = 'included'
      AND EXISTS (
        SELECT 1 FROM brochures b
         WHERE b.id = brochure_entries.brochure_id AND b.status = 'published'
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Write. Brochures manager-only; their contents member-writable (decision 6).
-- -----------------------------------------------------------------------------
CREATE POLICY "brochures_managers_crud"
  ON brochures FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

CREATE POLICY "brochure_sections_members_crud"
  ON brochure_sections FOR ALL
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

CREATE POLICY "brochure_entries_members_crud"
  ON brochure_entries FOR ALL
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

CREATE POLICY "brochures_superadmin_all"
  ON brochures FOR ALL
  USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());
CREATE POLICY "brochure_sections_superadmin_all"
  ON brochure_sections FOR ALL
  USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());
CREATE POLICY "brochure_entries_superadmin_all"
  ON brochure_entries FOR ALL
  USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());

COMMENT ON TABLE brochure_entries IS
  'Materialized membership in a brochure. Copy is snapshotted at pull time and '
  'then owned by the entry — editing the source never rewrites a published '
  'brochure. status = dismissed is a tombstone: it keeps a re-pull from '
  'resurrecting something a human removed.';

COMMENT ON COLUMN schedule_groups.in_brochure IS
  'Candidate for a season brochure. Candidacy, not membership — the brochure '
  'editor pulls candidates explicitly (migration 031).';
