-- Rollback for migration 059. Removes per-department statutory holidays.
--
-- DESTRUCTIVE IN ONE DIRECTION ONLY, and worth knowing which. Dropping these
-- tables does not break any session: a following session simply stops being
-- interrupted, and runs its normal weekly hours on Christmas Day again — the
-- behaviour it had before 059 existed. Nothing renders blank, nothing 500s.
--
-- What is lost is the decisions. Every "we close for this one", every
-- reduced-hours window, and the record of which dates staff had already
-- reviewed for the year, all go. Re-applying 059 brings back empty tables, and
-- the year has to be worked through again from the catalogue.
--
-- The windows table is dropped first only for clarity; the FK cascade from
-- department_holidays would take it anyway.

DROP TABLE IF EXISTS department_holiday_windows;
DROP TABLE IF EXISTS department_holidays;
