-- =============================================================================
-- Migration 050: Template description, tags, and registration links
-- =============================================================================
-- Three additions to `session_templates`, all of them presentation, all of them
-- nullable/optional so every template and widget that exists today renders
-- byte-identically until someone fills one in.
--
--  1. `description` — plain text on the template. Shown in the public session
--     detail modal when a visitor clicks a session.
--  2. `tags` + `session_template_tags` — a facility-scoped *vocabulary*,
--     joined many-to-many to templates.
--  3. `session_template_links` — ordered {label, url}, at most 3 per template.
--
-- All three live on the template, not the session. Per-occurrence overrides are
-- deliberately out of scope: a session placed from a template is an independent
-- row (013), so an override would need its own copy of all three and a rule for
-- which wins — that is a bigger decision than this migration, and making it by
-- accident here would be the wrong way to make it.
--
-- WHY TAGS ARE A TABLE AND NOT A TEXT[] COLUMN
--
-- Free text does not survive three coordinators. "Women's Only", "Womens only"
-- and "WOMEN'S ONLY" are one concept typed three ways, and the moment the
-- public legend prints all three the legend is worse than no legend — a patron
-- reading a paper schedule cannot tell whether they name the same thing. A
-- vocabulary row per concept, unique per facility (case-insensitively, see the
-- index below), is the whole point: the colour and the spelling are decided
-- once, by whoever owns the building's schedule, and every template that
-- reaches for the tag gets that same decision.
--
-- Facility-scoped rather than org-scoped because the legend is a property of a
-- building's printed schedule. Two pools in one parks department genuinely do
-- run different conventions, and an org-wide list would put one pool's tags in
-- the other's picker with no way to tell them apart.
--
-- WHY LINKS ARE A TABLE AND CARRY A MANDATORY LABEL
--
-- `label` is NOT NULL and the UI never renders a bare URL. "Register here" is
-- what a patron can act on; "https://anc.ca.saanich.bc.ca/mrmfinal/..." is
-- noise that also happens to be unreadable on a printed schedule. Ordered, so
-- staff control which of the three comes first.
--
-- The cap of 3 is enforced structurally rather than by a trigger: display_order
-- is CHECKed to 0..2 and made UNIQUE per template, so a fourth link has nowhere
-- to sit. A trigger counting rows would be racy under concurrent inserts; this
-- cannot be.
--
-- THE POLICY THAT MAKES ANY OF THIS VISIBLE
--
-- `session_templates` has had **no public-read policy** since 013, which said
-- not to add one by reflex. This is not reflex — it is the precondition for the
-- feature, and it was verified against the live database rather than reasoned
-- about: an anonymous read of /api/sessions/expand over a published facility
-- with an approved week returns occurrences whose `templateName` and
-- `templateColor` are **null**, because PostgREST nulls an embedded resource
-- that RLS filters. Every public surface has therefore been falling back to the
-- schedule *group* name this whole time.
--
-- That also means the comment in 047 stating "session_templates has a
-- public-read policy" was wrong when it was written, and
-- `components/schedule/README.md`'s label chain (holder → template → group)
-- has never reached its middle link for a patron. Both are corrected alongside
-- this migration.
--
-- The policy below mirrors `session_spaces_public_read` (020) — reachable from
-- an active session under a published schedule group — and adds one condition
-- 020 does not need:
--
--   AND s.disclosure = 'public'
--
-- Without it, 047's protection would come apart. `applyDisclosure()` nulls
-- templateName/templateColor for a *reserved* session so a renter is not named,
-- but `sessions.template_id` is itself publicly readable; anyone with the
-- publishable key could read the session row, take its template_id, and query
-- the template directly for the name the API had just withheld. Gating the
-- policy on the session's own disclosure closes that correlation, so the
-- schema-level rule and the API-level projection now agree instead of one
-- quietly undoing the other.
--
-- Note this is the *session's* disclosure, not the template's: a template that
-- usually runs public can be placed as a one-off reserved booking, and it is
-- the booking that decides.
--
-- Rollback: supabase/rollbacks/050_template_description_tags_links.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Description
-- -----------------------------------------------------------------------------

ALTER TABLE session_templates
  ADD COLUMN description TEXT;

COMMENT ON COLUMN session_templates.description IS
  'Plain text shown in the public session detail modal. No markdown — a '
  'renderer here would have to be safe on a public surface, and the printed '
  'board view has nowhere to put emphasis anyway.';

-- -----------------------------------------------------------------------------
-- 2. Tags — the facility's vocabulary
-- -----------------------------------------------------------------------------

CREATE TABLE tags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_id   UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  label         TEXT NOT NULL CHECK (length(trim(label)) > 0),
  -- NOT NULL, unlike session_templates.color. A template without a colour falls
  -- back to its sport category; a tag has nothing to fall back to, because the
  -- colour *is* the legend entry on the printed schedule.
  color         TEXT NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness per facility. This is the constraint that makes
-- it a vocabulary rather than free text wearing a foreign key: "Women's Only"
-- and "women's only" cannot both exist to be chosen between.
CREATE UNIQUE INDEX idx_tags_facility_label_unique
  ON tags (facility_id, lower(trim(label)));

CREATE INDEX idx_tags_facility_id ON tags (facility_id);
CREATE INDEX idx_tags_org_id ON tags (org_id);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

-- Public read is gated on the facility being published, mirroring
-- spaces_public_read_published (012). The legend belongs to a published
-- building's schedule; an unpublished facility's vocabulary is staff-only.
CREATE POLICY "tags_public_read"
  ON tags FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM facilities f
      WHERE f.id = tags.facility_id AND f.is_published = TRUE
    )
  );

CREATE POLICY "tags_managers_crud"
  ON tags FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

COMMENT ON TABLE tags IS
  'Facility-scoped tag vocabulary. Rendered on session cards in every schedule '
  'view including the printed board, replacing the asterisks and colour keys '
  'on paper schedules.';

-- -----------------------------------------------------------------------------
-- 3. Tag assignment
-- -----------------------------------------------------------------------------

CREATE TABLE session_template_tags (
  session_template_id UUID NOT NULL REFERENCES session_templates(id) ON DELETE CASCADE,
  tag_id              UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Which two show on a card when there are more than two (the rest go to the
  -- detail modal). Staff-controlled, so the one that matters on paper is the
  -- one that survives the truncation.
  display_order       INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_template_id, tag_id)
);

CREATE INDEX idx_session_template_tags_tag_id ON session_template_tags (tag_id);
CREATE INDEX idx_session_template_tags_org_id ON session_template_tags (org_id);

ALTER TABLE session_template_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "session_template_tags_public_read"
  ON session_template_tags FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.template_id = session_template_tags.session_template_id
        AND s.is_active = TRUE
        AND sg.status = 'published'
        AND s.disclosure = 'public'
    )
  );

CREATE POLICY "session_template_tags_managers_crud"
  ON session_template_tags FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

-- -----------------------------------------------------------------------------
-- 4. Registration links
-- -----------------------------------------------------------------------------

CREATE TABLE session_template_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_template_id UUID NOT NULL REFERENCES session_templates(id) ON DELETE CASCADE,
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label               TEXT NOT NULL CHECK (length(trim(label)) > 0),
  -- http/https only, and asserted here as well as in the API. This value ends
  -- up in an href on a public page, so a `javascript:` URL stored by any path
  -- that skips the route would be stored XSS. The CHECK is the backstop that
  -- does not depend on which code did the writing.
  url                 TEXT NOT NULL CHECK (url ~* '^https?://[^[:space:]]+$'),
  -- 0..2 UNIQUE per template is the "max 3" rule. See the header.
  display_order       INTEGER NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_template_id, display_order)
);

CREATE INDEX idx_session_template_links_template_id
  ON session_template_links (session_template_id);
CREATE INDEX idx_session_template_links_org_id ON session_template_links (org_id);

ALTER TABLE session_template_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "session_template_links_public_read"
  ON session_template_links FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.template_id = session_template_links.session_template_id
        AND s.is_active = TRUE
        AND sg.status = 'published'
        AND s.disclosure = 'public'
    )
  );

CREATE POLICY "session_template_links_managers_crud"
  ON session_template_links FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

-- -----------------------------------------------------------------------------
-- 5. The public-read policy on session_templates itself
--
-- See the header for why this exists, why 013's "do not add one by reflex" is
-- not being ignored, and what the disclosure condition is load-bearing for.
-- -----------------------------------------------------------------------------

CREATE POLICY "session_templates_public_read"
  ON session_templates FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.template_id = session_templates.id
        AND s.is_active = TRUE
        AND sg.status = 'published'
        AND s.disclosure = 'public'
    )
  );

-- -----------------------------------------------------------------------------
-- 6. One more analytics event
--
-- A registration link click, alongside the existing program_click that fires
-- when the modal opens. Both are needed to say anything useful: program_click
-- counts interest, link_click counts intent, and the ratio between them is the
-- only evidence a coordinator will ever get that a link is worth maintaining.
-- -----------------------------------------------------------------------------

ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_event_type_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type IN (
    'widget_view',       -- Widget iframe loaded (fired once per widget.js load)
    'program_click',     -- Visitor opened a session's detail modal
    'facility_view',     -- Public facility detail page viewed
    'schedule_view',     -- Weekly schedule viewed on public site (reserved, unused)
    'view_change',       -- Visitor switched template (grid/list/map/floorplan/board)
    'session_duration',  -- Time-on-page for one visit, sent on unload
    'link_click'         -- Visitor followed a registration link from the detail modal
  ));

COMMENT ON COLUMN analytics_events.event_type IS
  'See the CHECK constraint for the vocabulary. link_click (050) fires from the '
  'session detail modal and carries the same org/facility/schedule_group '
  'attribution as program_click.';
