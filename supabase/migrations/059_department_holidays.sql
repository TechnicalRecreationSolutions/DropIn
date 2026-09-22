-- =============================================================================
-- Migration 059: Statutory holidays, per department
-- =============================================================================
-- Migration 058 gave a department a weekly pattern of open/close windows, and
-- sessions that follow it. This is the gap 058 left open on purpose: a weekly
-- pattern says what happens on "a Monday", and Christmas Day is a Monday.
--
-- Before this, an all-day session ran its normal hours on Christmas until
-- someone cancelled that occurrence by hand, on every affected session, every
-- year. That is the same copy-of-a-number-that-lives-elsewhere problem 058 was
-- built to kill, so it is solved the same way: the holiday is recorded once,
-- against the department, and every following session resolves through it.
--
--
-- THE MODEL: THE CALENDAR PROPOSES, STAFF DISPOSE
--
-- Statutory holidays are a jurisdiction's facts, not a product's. They differ
-- by province today and will differ by state when this crosses the border, the
-- rules are a mix of fixed dates, nth-weekday rules and Easter arithmetic, and
-- which ones a given recreation centre actually closes for is a local
-- decision that no table can know. A pool may open reduced hours on Canada Day
-- and shut entirely on Christmas; the arena next door may do the reverse.
--
-- So the dates are SUGGESTED, never assumed. A catalogue in application code
-- (src/lib/schedule/holiday-catalogue.ts) computes the likely statutory days
-- for a province and year, and staff tick the ones they observe and say what
-- happens. Nothing from that catalogue is stored until a human agrees with it,
-- and a date nobody ticks has no row and therefore no effect.
--
-- Deliberately NOT a seeded table of dates. Seeding would mean shipping a
-- migration every year, re-seeding every org when a rule changes, and owning
-- the correctness of thirteen jurisdictions in the schema — while still not
-- knowing whether this particular pool closes. Computed suggestions cost
-- nothing to be wrong about: the wrong suggestion is one unticked checkbox.
--
--
-- ⚠️ THE TRAP: "NO ROW" MEANS THE OPPOSITE OF WHAT IT MEANS IN 058
--
-- In `department_hours`, a weekday with no rows is CLOSED — absence is the
-- only way to spell it, and that is documented as a feature.
--
-- Here, absence means NORMAL. A date with no `department_holidays` row falls
-- straight through to the weekly pattern, because the overwhelming majority of
-- dates are ordinary and must not need a row each.
--
-- The two tables therefore read absence in opposite directions, which is worth
-- knowing before changing either. It is also why `observance` is an explicit
-- three-state column rather than being inferred from whether any windows
-- exist: 'closed' and 'normal_hours' both have zero window rows, and only the
-- column tells them apart.
--
--
-- WHY PER-DEPARTMENT AND NOT PER-ORG
--
-- Hours are already per department (058), and the interesting answer here is
-- an hours answer — "we open 10-4" — not a date. A shared org-level date list
-- with per-department answers hanging off it would be a third table earning
-- its keep only by de-duplicating twelve short date strings a year.
--
-- Measured before choosing: every facility in the database has one or two
-- departments. The duplication is a handful of rows, created by one click
-- ("copy to the other departments here"), and it buys each department a fully
-- independent answer including whether it recognises the day at all.
-- =============================================================================

CREATE TABLE department_holidays (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  -- Denormalized from the parent for RLS, same as every other child table.
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The calendar date itself. A DATE, not a timestamp: a holiday is a day, and
  -- comparing it against a session occurrence means comparing YYYY-MM-DD
  -- strings — the same wall-clock convention as everything else in the
  -- schedule, with no instant and no zone anywhere near it.
  holiday_date  DATE NOT NULL,
  -- What staff call it. Copied from the catalogue when a suggestion is ticked,
  -- free text when they add their own, and editable either way — "Christmas
  -- Day" and "Closed for Christmas" are both legitimate things to show a
  -- patron, and the catalogue does not get a vote after the fact.
  name          TEXT NOT NULL,
  -- The three answers staff actually have:
  --
  --   'closed'        Shut all day. No occurrence for any following session.
  --   'custom_hours'  Open, but not the usual hours. Windows live in
  --                   department_holiday_windows; a row with this observance
  --                   and no windows is treated as closed (see the resolver),
  --                   because "open, hours unspecified" is not a schedule.
  --   'normal_hours'  Open exactly as the weekly pattern says.
  --
  -- 'normal_hours' looks redundant — it resolves identically to having no row
  -- at all — and it is kept anyway, because the checklist has to remember the
  -- difference between "we decided we work that day" and "nobody has looked at
  -- this yet". Without it the UI cannot show a reviewed year, and staff
  -- re-examine the same twelve dates every time they open the page.
  observance    TEXT NOT NULL
                CHECK (observance IN ('closed', 'custom_hours', 'normal_hours')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One answer per department per date. A second row for the same day could
  -- only ever be a contradiction, and the resolver would have to pick a winner
  -- arbitrarily.
  UNIQUE (department_id, holiday_date)
);

-- The read is always "every holiday for these departments, within this date
-- range" — the expansion layer's batch fetch, and the editor's year view.
CREATE INDEX idx_department_holidays_lookup
  ON department_holidays (department_id, holiday_date);

ALTER TABLE department_holidays ENABLE ROW LEVEL SECURITY;

-- Read: mirrors department_hours (058), which mirrors the parent department.
-- Closure information is *more* public than opening information, not less —
-- the entire point of publishing it is that a patron does not drive to a
-- locked building — so anything that can read the department can read this.
CREATE POLICY "department_holidays_public_read_published"
  ON department_holidays FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM departments d
       WHERE d.id = department_holidays.department_id
         AND (d.is_published = TRUE OR d.org_id = ANY(public.user_org_ids()))
    )
    OR public.is_superadmin()
  );

-- Write: the same authority as setting the department's hours (058), which is
-- the same as renaming it (055). Holidays are department configuration.
CREATE POLICY "department_holidays_write"
  ON department_holidays FOR ALL
  USING (public.can_write_department(department_id))
  WITH CHECK (public.can_write_department(department_id));

CREATE POLICY "department_holidays_superadmin_all"
  ON department_holidays FOR ALL
  USING (public.is_superadmin());


-- =============================================================================
-- DEPARTMENT_HOLIDAY_WINDOWS
-- =============================================================================
-- The open/close windows for a 'custom_hours' holiday. Same shape as
-- department_hours' windows, minus the weekday — the date is on the parent.
--
-- A separate table rather than a nullable `holiday_date` bolted onto
-- department_hours, so 058's table keeps exactly the invariants its header
-- claims: every row there is a weekday row, `day_of_week` is NOT NULL, and its
-- unique index means what it says. The cost is one extra table and one extra
-- query; the alternative was a table doing two jobs with a CHECK constraint
-- explaining which.
--
-- Multiple windows per holiday, for the same reason 058 has them: a centre
-- running 09:00-12:00 and 17:00-20:00 on Canada Day is expressing a real gap,
-- and flattening it would publish hours the building is locked for.
-- =============================================================================

CREATE TABLE department_holiday_windows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_id UUID NOT NULL REFERENCES department_holidays(id) ON DELETE CASCADE,
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opens_at   TIME NOT NULL,
  closes_at  TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT department_holiday_windows_ordered CHECK (closes_at > opens_at),
  UNIQUE (holiday_id, opens_at, closes_at)
);

CREATE INDEX idx_department_holiday_windows_lookup
  ON department_holiday_windows (holiday_id, opens_at);

ALTER TABLE department_holiday_windows ENABLE ROW LEVEL SECURITY;

-- Both policies read through the parent holiday, which reads through the
-- department — one chain, so a department going back to draft takes its
-- holidays and their hours out of public view together, with nothing to keep
-- in step.
CREATE POLICY "department_holiday_windows_public_read_published"
  ON department_holiday_windows FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM department_holidays h
        JOIN departments d ON d.id = h.department_id
       WHERE h.id = department_holiday_windows.holiday_id
         AND (d.is_published = TRUE OR d.org_id = ANY(public.user_org_ids()))
    )
    OR public.is_superadmin()
  );

CREATE POLICY "department_holiday_windows_write"
  ON department_holiday_windows FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM department_holidays h
       WHERE h.id = department_holiday_windows.holiday_id
         AND public.can_write_department(h.department_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM department_holidays h
       WHERE h.id = department_holiday_windows.holiday_id
         AND public.can_write_department(h.department_id)
    )
  );

CREATE POLICY "department_holiday_windows_superadmin_all"
  ON department_holiday_windows FOR ALL
  USING (public.is_superadmin());
