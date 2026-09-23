-- =============================================================================
-- Migration 060: Facility status notices
-- =============================================================================
-- Everything this app publishes today is what a facility INTENDS to run. A
-- schedule is a plan, `department_hours` (058) is a pattern, `session_
-- exceptions` cancels a date someone knew about in advance. None of it can say
-- what is true right now.
--
-- The cases that motivated this, all from real recreation centres:
--
--   * a fecal or vomit contamination closes a pool for hours, decided on deck
--   * a filtration fault or chemical imbalance does the same, for longer
--   * a lifeguard calls in sick and the 6am lengths swim does not happen
--   * the building is at capacity and there is no point driving over
--
-- Each of these is: something is wrong, it started a few minutes ago, it will
-- end when it ends, and a patron must be told in the same place they read the
-- schedule. A notice is that object.
--
--
-- WHY NOT A SESSION
--
-- `occupancy_kind = 'closure'` (046) already closes a space, and it is the
-- right tool for a closure you can plan: the tank is out for maintenance in
-- March, the arena is booked for a tournament. It is the wrong tool here, for
-- three reasons, and conflating the two would damage both:
--
--  1. A session is a recurrence rule. A contamination is one unrepeatable
--     interval that started at 14:12 and might end at 16:00. Expressing it as
--     an RRULE with a one-off exception is writing a plan to describe an
--     accident.
--  2. A session claims SPACES, and the conflict engine reasons about that
--     claim. "We are short a lifeguard, the timetable stands but nothing is
--     guarded" claims nothing and conflicts with nothing — it is a statement
--     about the building, not about the water.
--  3. A closure session removes the block from the schedule. A patron who
--     already looked this morning needs to be TOLD, not to find an absence.
--     That is the same reasoning 046 used to keep 'reserved' rows visible with
--     their identity stripped rather than hiding them.
--
-- So: a separate, small, short-lived object that sits ABOVE the schedule and
-- never inside it. Nothing in the expansion pipeline reads this table.
--
--
-- TWO AXES, NOT ONE — the 046 lesson, applied again
--
-- `category` says what KIND of thing happened. `severity` says HOW BAD it is
-- for the patron. They are orthogonal, and every attempt to collapse them
-- breaks on the first real pair of examples:
--
--   water_quality + closure   "Pool closed — fecal contamination"
--   water_quality + caution   "Water is cloudy; lengths swim continues"
--   staffing      + closure   "No lifeguard available — pool closed"
--   staffing      + info      "Reduced hours today — one guard on shift"
--
-- A single "type" column would have to pick one of those four for each word,
-- and the other three would have to lie. The category drives the icon and the
-- reporting; the severity drives the colour and whether the schedule below is
-- struck through. A preset in application code supplies a sensible pairing
-- (src/lib/status/notice-presets.ts) and staff may change either.
--
--
-- ⚠️ `ends_at` IS THE ONLY LIFECYCLE COLUMN
--
-- There is no `resolved_at`, no `is_active`, no status enum. A notice is live
-- when now() is inside [starts_at, ends_at), and clearing one sets `ends_at`
-- to now(). One column cannot disagree with itself about whether a notice is
-- over, and two of them eventually would — an early draft of this had both and
-- immediately produced rows that were resolved but not ended.
--
-- The consequence worth knowing: THE PUBLIC READ POLICY DEPENDS ON now(). A
-- cached copy of a page that embeds a notice is only as correct as its cache
-- lifetime, so the facility page reads notices through their own
-- cacheLife("minutes") entry rather than joining the hours-long entry that
-- carries the rest of the page. See src/lib/cache/tags.ts.
--
--
-- WHO MAY POST ONE — an organization's decision, not ours
--
-- The person who knows the pool is contaminated is the guard standing next to
-- it, and that guard is an `aux` staffer: the role 055 defined as read-only
-- everywhere. Some organizations want that guard to be able to close the pool
-- to the public in ten seconds. Others consider publishing to patrons a
-- supervisor's act, no matter who noticed.
--
-- Both are right about their own building, so `organizations.
-- aux_can_post_notices` lets each one answer for itself. It defaults to FALSE:
-- widening a read-only role is an opt-in, never a surprise on deploy.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The organization-level switch
-- -----------------------------------------------------------------------------
-- Safe to add here: organizations_guard_platform_columns() (057) rejects member
-- writes to `status`, `approved_at` and `approved_by` only. This column is the
-- organization's own policy and is written by its owner or manager through the
-- ordinary organizations UPDATE policy.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS aux_can_post_notices BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN organizations.aux_can_post_notices IS
  'When true, aux staff (lifeguards, front desk) may post and clear public '
  'facility notices for the facilities in their scope (migration 060). '
  'Defaults false: aux is otherwise a read-only role, and widening it is an '
  'opt-in decision each organization makes about its own staff.';


-- -----------------------------------------------------------------------------
-- 2. The notices
-- -----------------------------------------------------------------------------

CREATE TABLE facility_notices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  -- Denormalized from the parent for RLS, same as every other child table.
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- NULL = the whole facility. A named space narrows it: "the hot tub is
  -- down" and "the building is closed" are the same object at two scopes, and
  -- a separate table per scope would duplicate every column to express it.
  space_id    UUID REFERENCES spaces(id) ON DELETE CASCADE,

  -- WHAT happened. Drives the icon and any future reporting; deliberately a
  -- short closed list rather than free text, because "why do we keep closing?"
  -- is a question an operator will eventually ask of this table.
  category    TEXT NOT NULL CHECK (category IN (
                'water_quality',   -- contamination, chemistry, clarity
                'mechanical',      -- filtration, boiler, compressor, lift
                'staffing',        -- no guard, no instructor, sick call
                'weather',         -- storm, smoke, heat
                'maintenance',     -- unscheduled repair
                'capacity',        -- full; come back later
                'power',           -- outage, generator
                'other'
              )),

  -- HOW BAD it is for the patron. Orthogonal to category — see the header.
  --   info    — worth knowing, the schedule stands
  --   caution — the schedule stands but something is degraded
  --   closure — do not come; this space or facility is not usable
  severity    TEXT NOT NULL CHECK (severity IN ('info', 'caution', 'closure')),

  -- One line a patron reads at a glance, and an optional paragraph. Bounded in
  -- the database as well as the form: this text renders on the public page and
  -- inside a 320px-wide embedded widget, and an unbounded headline is a layout
  -- bug that arrives through the API rather than the UI.
  headline    TEXT NOT NULL CHECK (char_length(trim(headline)) BETWEEN 1 AND 120),
  body        TEXT CHECK (body IS NULL OR char_length(body) <= 1000),

  -- The live window. `starts_at` defaults to now() because the overwhelming
  -- case is "this is happening"; a future value schedules a notice, which
  -- costs nothing extra to support and covers "we close at 3 for a repair".
  --
  -- ends_at NULL = until cleared. See the header: this is the ONLY lifecycle
  -- column, and clearing a notice means setting it to now().
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at     TIMESTAMPTZ,

  -- Whether the public may see it at all. Independent of the window, so a
  -- notice can be written, reviewed and published without its clock moving —
  -- and so an organization can keep an internal record of something patrons
  -- were never told about.
  is_published BOOLEAN NOT NULL DEFAULT FALSE,

  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A window that ends before it starts is not a typo the UI should have to
  -- catch on behalf of every caller.
  CONSTRAINT facility_notices_window CHECK (ends_at IS NULL OR ends_at > starts_at)
);

COMMENT ON TABLE facility_notices IS
  'What is true at a facility RIGHT NOW, as opposed to what it plans to run '
  '(migration 060). Sits above the schedule and is never read by the '
  'expansion pipeline. Live when now() is inside [starts_at, ends_at).';

COMMENT ON COLUMN facility_notices.space_id IS
  'NULL means the whole facility. A named space narrows the notice to it.';

COMMENT ON COLUMN facility_notices.ends_at IS
  'NULL means "until cleared". Clearing a notice sets this to now(). There is '
  'deliberately no second lifecycle column to contradict it.';

-- The public read, and the staff list, both start from the facility and want
-- the newest first.
CREATE INDEX idx_facility_notices_facility
  ON facility_notices (facility_id, starts_at DESC);

-- The hot path: "what is live at this facility". Partial, because an
-- unpublished or long-finished notice is never on it.
CREATE INDEX idx_facility_notices_live
  ON facility_notices (facility_id, ends_at)
  WHERE is_published;

-- No updated_at trigger: this schema has never had one (there is no shared
-- update_updated_at_column() to hang it on), and every route that touches a
-- timestamped row writes `updated_at: new Date().toISOString()` itself —
-- schedule_groups, session_templates, tags. Adding a trigger for one table
-- would make this the only row in the database whose timestamp means something
-- slightly different from all the others.


-- -----------------------------------------------------------------------------
-- 3. Who may write one
-- -----------------------------------------------------------------------------
-- Three tiers, and the third is the organization's own choice:
--
--   owner / manager  anywhere in their organization (org_can_manage)
--   coordinator      facilities their scope covers
--   aux              facilities their scope covers, IF the org opted in
--
-- Coordinators are scoped by DEPARTMENT, but a notice is a facility-level
-- object — a contaminated pool is not an Aquatics-only fact. user_scope_
-- facility_ids() (055) already resolves a department scope up to its facility,
-- which is exactly the widening wanted here and the reason that helper exists.

CREATE OR REPLACE FUNCTION public.can_write_notice(p_facility_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM facilities f
      JOIN organizations o ON o.id = f.org_id
     WHERE f.id = p_facility_id
       AND (
         public.org_can_manage(f.org_id)
         OR (
           public.org_role(f.org_id) = 'coordinator'
           AND f.id = ANY(public.user_scope_facility_ids())
         )
         OR (
           public.org_role(f.org_id) = 'aux'
           AND o.aux_can_post_notices
           AND f.id = ANY(public.user_scope_facility_ids())
         )
       )
  );
$$;

COMMENT ON FUNCTION public.can_write_notice(UUID) IS
  'Write authority over a facility''s public notices (migration 060): '
  'owner/manager org-wide, coordinator within scope, and aux within scope only '
  'when organizations.aux_can_post_notices is true. The application layer asks '
  'the same question through notice:write in src/lib/auth/roles.ts; THIS is '
  'the control.';


-- -----------------------------------------------------------------------------
-- 4. RLS
-- -----------------------------------------------------------------------------

ALTER TABLE facility_notices ENABLE ROW LEVEL SECURITY;

-- Read. Two disjoint audiences:
--
--   staff    — every row in their own organization, including drafts, future
--              notices and finished ones. The history IS the value for them.
--   public   — published, currently inside its window, on a published
--              facility. Nothing else, ever.
--
-- Note the ORDER of the disjuncts is irrelevant to correctness but the SHAPE
-- is not: the staff clause is a plain membership test rather than a role test,
-- because an aux staffer who may not post a notice must still be able to read
-- the one telling them the pool is shut.
CREATE POLICY "facility_notices_read"
  ON facility_notices FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR (
      is_published
      AND starts_at <= NOW()
      AND (ends_at IS NULL OR ends_at > NOW())
      AND EXISTS (
        SELECT 1 FROM facilities f
         WHERE f.id = facility_notices.facility_id
           AND f.is_published
      )
    )
    OR public.is_superadmin()
  );

CREATE POLICY "facility_notices_write"
  ON facility_notices FOR ALL
  USING (public.can_write_notice(facility_id))
  WITH CHECK (public.can_write_notice(facility_id));

CREATE POLICY "facility_notices_superadmin_all"
  ON facility_notices FOR ALL
  USING (public.is_superadmin());


-- =============================================================================
-- VERIFYING
-- =============================================================================
--   node scripts/verify/verify-az.mjs
--
-- The assertions that matter here, each falsified to prove it bites:
--   * an unpublished notice, one whose window has passed, and one on an
--     unpublished facility are all invisible to a NEVER-SIGNED-IN client;
--   * a live one is visible to that same client (the positive control — without
--     it, a broken policy reads as four passes);
--   * an aux INSERT is refused with aux_can_post_notices false and accepted
--     with it true, same fixture, same staffer;
--   * a coordinator is refused a facility outside their scope.
-- =============================================================================
