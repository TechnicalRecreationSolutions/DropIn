-- =============================================================================
-- Migration 038: Activity Log
-- =============================================================================
-- Staff want to see who changed what, and undo a change that shouldn't have
-- happened — see docs/RESUME-layout-rework.md's "Activity log / audit trail"
-- section, which this closes out. Two things were needed: a table to hold the
-- history, and reliable write points that can't be missed by a route that
-- forgets to call them.
--
-- DESIGN DECISIONS
--
-- 1. Triggers, not hand-added writes in each API route. The alternative —
--    inserting an activity_log row inside every POST/PATCH/DELETE handler —
--    is easy to forget on the next new route, and easy to get subtly wrong
--    (e.g. logging the request body instead of what was actually written).
--    A trigger on the table itself can't be skipped and always reflects the
--    real row. It also means /api/schedule-groups's one direct-from-browser
--    write (see that route's own note) is covered for free.
--
-- 2. Scope: facilities, departments, spaces, schedule_groups, sessions,
--    session_templates. These are the tables staff actually think of as
--    "the schedule" — the same set org_can_manage()'s comment (migration
--    024) calls out as structural, plus sessions/session_templates as the
--    content built on top. session_exceptions, facility_maps and
--    widget_configs are left out for now (noisier, lower-value to review) —
--    a follow-up, not a gap in this design.
--
-- 3. Before/after snapshots (to_jsonb of OLD/NEW), not a diff of specific
--    columns. Storing the whole row is what makes revert possible without
--    knowing in advance which columns matter, and a full snapshot is what
--    lets a future UI show "what changed" for any column without a second
--    migration.
--
-- 4. Skip pure updated_at-only bumps. Migration 035 added triggers that
--    touch schedule_groups.updated_at whenever a session under it changes,
--    purely so the "modified since publish" status works — that's a
--    housekeeping write, not a staff action, and logging it would bury real
--    schedule_groups edits under noise from every session save. The check is
--    generic (any UPDATE where the only changed key is updated_at is
--    skipped) rather than special-cased to that one trigger, so it also
--    covers any future touch-only trigger the same way.
--
-- 5. Revert is a single SECURITY DEFINER function (revert_activity), not
--    per-entity revert code in the API layer, for the same reason as #1: one
--    implementation that works for every logged table because it reads the
--    column list from information_schema rather than hard-coding it per
--    table. It only ever acts on rows this trigger wrote (table_name comes
--    from TG_TABLE_NAME, never from a user), so the dynamic SQL inside it is
--    not attacker-controlled.
--
--    Known limitation: reverting a row whose delete cascaded into children
--    (e.g. a deleted facility's departments/spaces/schedules/sessions) only
--    restores that one row, not the whole subtree — each child has its own
--    activity_log entry and would need its own revert, oldest-child-first.
--    Good enough for "I didn't mean to edit/delete this one thing", not a
--    full point-in-time restore.
--
-- Rollback: supabase/rollbacks/038_activity_log.sql
-- =============================================================================

CREATE TABLE activity_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Snapshot, not a live join to auth.users — stays correct even if the
  -- actor's email later changes or the account is deleted.
  actor_email    TEXT,
  table_name     TEXT NOT NULL,
  row_id         UUID NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  -- Best-effort human label captured at write time (e.g. the facility's
  -- name), so the log still reads sensibly after the row itself is gone.
  entity_label   TEXT,
  -- UPDATE only — the keys (excluding updated_at) whose value actually
  -- changed. NULL for insert/delete, where the whole row is new/gone.
  changed_fields TEXT[],
  before         JSONB,
  after          JSONB,
  reverted_at    TIMESTAMPTZ,
  reverted_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX activity_log_org_created_idx ON activity_log (org_id, created_at DESC);
CREATE INDEX activity_log_row_idx ON activity_log (table_name, row_id);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Any org member can read their org's log — this is the transparency the
-- feature is for, not an admin-only tool. Reverting is gated separately,
-- inside revert_activity() itself.
CREATE POLICY "activity_log_org_read"
  ON activity_log FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- Deliberately no INSERT/UPDATE/DELETE policy for authenticated/anon roles.
-- Writes only happen through log_activity() (trigger) and revert_activity()
-- (RPC below), both SECURITY DEFINER — a user can't forge or edit history
-- via a direct PostgREST call even with the publishable key.

-- -----------------------------------------------------------------------------
-- log_activity() — attached to every table in scope below.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_before JSONB;
  v_after  JSONB;
  v_changed TEXT[];
  v_label  TEXT;
BEGIN
  v_org_id := COALESCE(NEW.org_id, OLD.org_id);

  -- Guard against a delete that's cascading from the parent organization
  -- itself being removed. Every table this trigger is on has org_id ON
  -- DELETE CASCADE straight off organizations (see migration 001 and
  -- friends), so a `DELETE FROM organizations` cascades to all of them in
  -- the same statement — and Postgres removes the organizations row first,
  -- *then* fires the cascade. By the time this trigger runs, v_org_id no
  -- longer exists in organizations, so an activity_log insert referencing
  -- it would violate activity_log's own org_id FK. There's also no org left
  -- for anyone to read this entry in, so skipping is the right behaviour,
  -- not just a workaround for the FK.
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = v_org_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_before := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END;
  v_after  := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(a.key ORDER BY a.key) INTO v_changed
    FROM jsonb_each(v_after) a
    WHERE a.key <> 'updated_at'
      AND a.value IS DISTINCT FROM (v_before -> a.key);

    -- Nothing but updated_at moved (e.g. migration 035's touch triggers) —
    -- not a staff action worth showing.
    IF v_changed IS NULL THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  -- sessions has no name of its own — fall back to its parent schedule's
  -- name so the log still reads as something recognizable.
  --
  -- IF/ELSE, not a single SQL CASE expression: NEW/OLD are generic RECORDs
  -- in a shared trigger function, and a CASE mixing NEW.schedule_group_id
  -- (only present on sessions) with NEW.name (absent on sessions) gets
  -- compiled as one query type-checked against whatever table actually
  -- fired the trigger — it fails to parse for every *other* table, which
  -- doesn't have schedule_group_id, even though that branch would never
  -- run for them. Each IF/ELSIF branch is its own statement, only compiled
  -- against NEW's real type when that branch actually executes.
  IF TG_TABLE_NAME = 'sessions' THEN
    SELECT sg.name INTO v_label FROM schedule_groups sg
      WHERE sg.id = COALESCE(NEW.schedule_group_id, OLD.schedule_group_id);
  ELSE
    v_label := COALESCE(NEW.name, OLD.name);
  END IF;

  INSERT INTO activity_log (
    org_id, actor_user_id, actor_email, table_name, row_id, action,
    entity_label, changed_fields, before, after
  ) VALUES (
    v_org_id,
    auth.uid(),
    (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    lower(TG_OP),
    v_label,
    v_changed,
    v_before,
    v_after
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER facilities_log_activity
  AFTER INSERT OR UPDATE OR DELETE ON facilities
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

CREATE TRIGGER departments_log_activity
  AFTER INSERT OR UPDATE OR DELETE ON departments
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

CREATE TRIGGER spaces_log_activity
  AFTER INSERT OR UPDATE OR DELETE ON spaces
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

CREATE TRIGGER schedule_groups_log_activity
  AFTER INSERT OR UPDATE OR DELETE ON schedule_groups
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

CREATE TRIGGER sessions_log_activity
  AFTER INSERT OR UPDATE OR DELETE ON sessions
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

CREATE TRIGGER session_templates_log_activity
  AFTER INSERT OR UPDATE OR DELETE ON session_templates
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- -----------------------------------------------------------------------------
-- revert_activity(p_activity_id) — undo a single logged change.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_activity(p_activity_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_row  activity_log%ROWTYPE;
  v_cols TEXT;
BEGIN
  SELECT * INTO v_row FROM activity_log WHERE id = p_activity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity entry not found';
  END IF;

  IF NOT public.org_can_manage(v_row.org_id) THEN
    RAISE EXCEPTION 'Only an org owner or admin can revert an activity entry';
  END IF;

  IF v_row.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This change has already been reverted';
  END IF;

  IF v_row.action = 'insert' THEN
    -- Undo a create: remove the row it added.
    EXECUTE format('DELETE FROM %I WHERE id = $1', v_row.table_name)
      USING v_row.row_id;

  ELSIF v_row.action = 'delete' THEN
    -- Undo a delete: reinsert exactly what was there before, including its
    -- original id, so anything that still references it (if not itself
    -- cascade-deleted) points at the same row again.
    EXECUTE format(
      'INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, $1)',
      v_row.table_name, v_row.table_name
    ) USING v_row.before;

  ELSIF v_row.action = 'update' THEN
    -- Undo an edit: restore every column (not just the changed ones) to its
    -- prior value. The column list is read from the catalog rather than
    -- hard-coded, so this works unchanged for every table the trigger is on.
    SELECT string_agg(quote_ident(c.column_name), ',' ORDER BY c.ordinal_position)
      INTO v_cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = v_row.table_name
       AND c.column_name <> 'id';

    EXECUTE format(
      'UPDATE %I AS t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::%I, $1)) WHERE t.id = $2',
      v_row.table_name, v_cols, v_cols, v_row.table_name
    ) USING v_row.before, v_row.row_id;
  END IF;

  UPDATE activity_log
     SET reverted_at = now(), reverted_by = auth.uid()
   WHERE id = p_activity_id;
END;
$$;

REVOKE ALL ON FUNCTION public.revert_activity(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revert_activity(UUID) TO authenticated;
