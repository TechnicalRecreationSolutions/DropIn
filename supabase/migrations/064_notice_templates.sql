-- =============================================================================
-- 064 — The status library, and statuses that belong to a department
-- =============================================================================
--
-- Until now the statuses a staffer could post were a hard-coded catalogue in
-- src/lib/status/notice-presets.ts: fourteen buttons, the same for everyone.
-- A tennis department was offered "Fecal / vomit contamination", and nobody
-- could add "Courts closed — wet" without a deploy.
--
-- This migration makes the catalogue each organization's own:
--
--   notice_templates             — the statuses an organization can post.
--   notice_template_departments  — which departments see each one. A template
--                                  with NO rows here is offered everywhere,
--                                  which is the right default for "Power
--                                  outage" and the only possible one for an
--                                  organization with no departments.
--   facility_notices.department_id
--                                — a posted notice may now be about one
--                                  department ("Tennis — short staffed")
--                                  rather than one space or the whole building.
--
-- ## A template is vocabulary, not history
--
-- Posting copies the template's words into a new facility_notices row, as
-- before. Nothing links the notice back to the template, so editing or
-- deleting a template never rewrites something patrons already read.
--
-- ## Seeding
--
-- Every existing organization, and every new one (trigger below), starts with
-- the old built-in catalogue so the page is never empty. The pool-specific
-- ones are assigned to departments whose name looks aquatic when the
-- organization has any — a guess, stated as one, and one edit to change.
--
-- Who manages the library: owner/manager (org_can_manage). Everyone in the
-- organization reads it, because everyone who can post needs to see it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS notice_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label         TEXT NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 60),
  category      TEXT NOT NULL CHECK (category IN (
                  'water_quality', 'mechanical', 'staffing', 'weather',
                  'maintenance', 'capacity', 'power', 'other'
                )),
  severity      TEXT NOT NULL CHECK (severity IN ('info', 'caution', 'closure')),
  headline      TEXT NOT NULL CHECK (char_length(trim(headline)) BETWEEN 1 AND 120),
  body          TEXT CHECK (body IS NULL OR char_length(body) <= 1000),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notice_templates IS
  'An organization''s library of facility statuses (migration 064). Posting '
  'copies a template into facility_notices; nothing links back, so editing a '
  'template never changes a notice already posted.';

CREATE INDEX IF NOT EXISTS idx_notice_templates_org
  ON notice_templates (org_id, display_order);

CREATE TABLE IF NOT EXISTS notice_template_departments (
  template_id   UUID NOT NULL REFERENCES notice_templates(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, department_id)
);

COMMENT ON TABLE notice_template_departments IS
  'Which departments are offered a status template (migration 064). No rows '
  'for a template means every department — and the whole-facility composer — '
  'is offered it.';

CREATE INDEX IF NOT EXISTS idx_notice_template_departments_department
  ON notice_template_departments (department_id);

-- A department must belong to the template's organization. Without this a
-- manager could attach another organization's department id and leak its
-- existence through a 201.
CREATE OR REPLACE FUNCTION public.notice_template_department_same_org()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM notice_templates t
      JOIN departments d ON d.org_id = t.org_id
     WHERE t.id = NEW.template_id
       AND d.id = NEW.department_id
  ) THEN
    RAISE EXCEPTION 'department % is not in the template''s organization', NEW.department_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notice_template_departments_same_org ON notice_template_departments;
CREATE TRIGGER notice_template_departments_same_org
  BEFORE INSERT OR UPDATE ON notice_template_departments
  FOR EACH ROW EXECUTE FUNCTION public.notice_template_department_same_org();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
ALTER TABLE notice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notice_template_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notice_templates_read" ON notice_templates;
CREATE POLICY "notice_templates_read"
  ON notice_templates FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

DROP POLICY IF EXISTS "notice_templates_manage" ON notice_templates;
CREATE POLICY "notice_templates_manage"
  ON notice_templates FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

DROP POLICY IF EXISTS "notice_template_departments_read" ON notice_template_departments;
CREATE POLICY "notice_template_departments_read"
  ON notice_template_departments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM notice_templates t
       WHERE t.id = notice_template_departments.template_id
         AND (t.org_id = ANY(public.user_org_ids()) OR public.is_superadmin())
    )
  );

DROP POLICY IF EXISTS "notice_template_departments_manage" ON notice_template_departments;
CREATE POLICY "notice_template_departments_manage"
  ON notice_template_departments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM notice_templates t
       WHERE t.id = notice_template_departments.template_id
         AND public.org_can_manage(t.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM notice_templates t
       WHERE t.id = notice_template_departments.template_id
         AND public.org_can_manage(t.org_id)
    )
  );

-- -----------------------------------------------------------------------------
-- A notice about one department
-- -----------------------------------------------------------------------------
ALTER TABLE facility_notices
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE CASCADE;

COMMENT ON COLUMN facility_notices.department_id IS
  'The department the notice is about (migration 064). NULL with space_id NULL '
  'means the whole facility. The API checks that the department is at this '
  'facility and that a named space belongs to it.';

CREATE INDEX IF NOT EXISTS idx_facility_notices_department
  ON facility_notices (department_id)
  WHERE department_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Seeding: the old built-in catalogue, once per organization
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_notice_templates(p_org_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  r RECORD;
  v_id UUID;
BEGIN
  -- Idempotent per organization: a library someone has started editing, or
  -- emptied on purpose, is never refilled.
  IF EXISTS (SELECT 1 FROM notice_templates WHERE org_id = p_org_id) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      (1,  true,  'Fecal / vomit contamination', 'water_quality', 'closure',
       'Pool closed — contamination',
       'The pool is closed while staff treat the water. This normally takes several hours. We will reopen as soon as it is safe to swim.'),
      (2,  true,  'Chemical imbalance', 'water_quality', 'closure',
       'Pool closed — water chemistry',
       'The water is outside its safe range and the pool is closed while staff correct it.'),
      (3,  true,  'Cloudy water (open)', 'water_quality', 'caution',
       'Water is cloudy — the pool is open',
       'Clarity is reduced while the filters catch up. Swimming continues and lifeguards are on deck.'),
      (4,  false, 'Mechanical fault', 'mechanical', 'closure',
       'Closed — mechanical fault',
       'A mechanical fault has closed this space. Repairs are under way.'),
      (5,  true,  'Pool lift out of service', 'mechanical', 'caution',
       'Pool lift out of service',
       'The accessibility lift is out of service. Please speak to staff on arrival about other ways into the water.'),
      (6,  true,  'Lifeguard shortage', 'staffing', 'closure',
       'Closed — no lifeguard available',
       'We cannot safely open without a guard on deck. Today''s sessions in this space are cancelled.'),
      (7,  false, 'Short-staffed', 'staffing', 'info',
       'Reduced hours today',
       'We are short-staffed today and running reduced hours. Check the schedule below before travelling.'),
      (8,  false, 'Class cancelled — instructor away', 'staffing', 'info',
       'A class is cancelled today',
       'The instructor is unavailable. Everything else runs as scheduled.'),
      (9,  false, 'Unscheduled maintenance', 'maintenance', 'closure',
       'Closed for maintenance',
       'Unscheduled maintenance has closed this space.'),
      (10, false, 'Power outage', 'power', 'closure',
       'Closed — power outage',
       'The building has lost power and is closed. We will post again when it is back.'),
      (11, false, 'Weather closure', 'weather', 'closure',
       'Closed — weather',
       'The facility is closed because of the weather.'),
      (12, false, 'Poor air quality', 'weather', 'caution',
       'Outdoor activities suspended — air quality',
       'Outdoor programming is suspended while air quality is poor. Indoor sessions run as scheduled.'),
      (13, false, 'At capacity', 'capacity', 'caution',
       'At capacity — please come back later',
       'We are full and are not admitting anyone else for now. This usually clears within the hour.')
    ) AS t(ord, is_pool, label, category, severity, headline, body)
  LOOP
    INSERT INTO notice_templates (org_id, label, category, severity, headline, body, display_order)
    VALUES (p_org_id, r.label, r.category, r.severity, r.headline, r.body, r.ord)
    RETURNING id INTO v_id;

    IF r.is_pool THEN
      INSERT INTO notice_template_departments (template_id, department_id)
      SELECT v_id, d.id
        FROM departments d
       WHERE d.org_id = p_org_id
         AND d.name ~* '(aquatic|pool|swim)';
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.seed_notice_templates(UUID) IS
  'Fills an organization''s empty status library with the built-in catalogue '
  '(migration 064). Pool-only statuses go to departments named like '
  'aquatics/pool/swim when any exist, otherwise to every department.';

REVOKE ALL ON FUNCTION public.seed_notice_templates(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_notice_templates_for_new_org()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM public.seed_notice_templates(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_seed_notice_templates ON organizations;
CREATE TRIGGER organizations_seed_notice_templates
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_notice_templates_for_new_org();

SELECT public.seed_notice_templates(id) FROM organizations;
