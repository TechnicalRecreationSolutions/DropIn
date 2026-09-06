-- =============================================================================
-- Migration 045: One widget configuration per organisation
-- =============================================================================
-- Migration 010 split widget_configs by facility+department so an org could run
-- a differently-themed embed on each page of its website. In practice that
-- second layer never earned its keep and quietly did harm:
--
--   * It was set by accident. /dashboard/widget pre-selects the sidebar's
--     current facility, so opening the page from a facility created that
--     facility's row — the org ends up with settings hidden behind a tile it
--     never deliberately chose, and no row at all for the org as a whole.
--   * It fractured the brand. /facility/[slug] reads the row for *its own*
--     facility with no fallback, so an org whose only row is facility-scoped
--     gets its real colour on one public page and the stock blue on every
--     other one — plus stock blue in /dashboard/schedule, which reads the
--     org-wide row.
--   * It duplicated the schedule switcher. widget_config_scopes (043) already
--     answers "which schedule is this showing", and it *overrides* the config's
--     own facility_id at render time, so the two controls disagreed and the
--     invisible one won.
--
-- The studio now edits one row per org, and a snippet that wants to show a
-- single facility says so in its own data-facility-id rather than by pointing
-- at a second saved row.
--
-- This promotes each org's settings to that one row. Orgs that already have an
-- org-wide row are left alone; orgs that don't get their most recently updated
-- scoped row promoted, so the colour and views someone actually configured
-- survive. The unique constraint from 010 (NULLS NOT DISTINCT) guarantees at
-- most one org-wide row, which is why the promotion is guarded on there being
-- none.
--
-- Rows *not* promoted are left in place rather than deleted: nothing reads them
-- any more, but deleting one would cascade to its widget_config_scopes rows and
-- throw away a switcher list the org may want to copy across. They can be
-- cleaned up by hand once every org has been through the new studio.
--
-- Not reversible in any meaningful sense — the pre-migration facility_id is not
-- recorded anywhere, so supabase/rollbacks/ has no counterpart for this one.
-- =============================================================================

WITH promotable AS (
  SELECT
    wc.id,
    ROW_NUMBER() OVER (PARTITION BY wc.org_id ORDER BY wc.updated_at DESC) AS rn
  FROM widget_configs wc
  WHERE NOT EXISTS (
    SELECT 1
    FROM widget_configs orgwide
    WHERE orgwide.org_id = wc.org_id
      AND orgwide.facility_id IS NULL
      AND orgwide.department_id IS NULL
  )
)
UPDATE widget_configs w
SET facility_id = NULL,
    department_id = NULL
FROM promotable p
WHERE w.id = p.id
  AND p.rn = 1;
