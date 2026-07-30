-- =============================================================================
-- Migration 018: Multi-lane preset groups
-- =============================================================================
-- A pool preset like "4-Lane 25m Pool" needs to show 4 independently-live
-- lanes, not one big rectangle standing in for a single Space. Placing such
-- a preset now creates N space_hotspots rows sharing one group_id, each
-- linked to its own Space so it can show its own live-session status.
--
-- Every row in a group stores the IDENTICAL outer rect (x/y/width/height/
-- rotation) — there is no designated "parent" row holding the real
-- geometry and children pointing at it. This avoids parent/child fragility
-- (delete the parent, orphan the children) and needs no extra join to
-- render: the group's outer rect is just any one of its rows' x/y/width/
-- height/rotation. The existing batch delete-and-reinsert PUT in
-- [id]/hotspots/route.ts already handles "N rows, same geometry, differing
-- lane_index" with no new logic — it's still just an array of rows.
--
-- lane_index only fixes a stable relative order for a group's rows across
-- save/reload (assigned once at placement, e.g. 0..N-1) — it is never read
-- as a literal slot number. Rendering sorts a group's rows by lane_index
-- and uses each row's position in that sorted list, together with the
-- group's current row COUNT (not a count captured at placement time), to
-- divide the outer rect into that many equal stripes. This means deleting
-- one lane just shrinks the count by one and the remaining lanes evenly
-- re-expand to fill the pool on the next render — no renumbering, no gaps
-- to special-case.
-- =============================================================================

ALTER TABLE space_hotspots
  ADD COLUMN group_id UUID,
  ADD COLUMN lane_index INTEGER;

ALTER TABLE space_hotspots
  ADD CONSTRAINT space_hotspots_group_lane_together
  CHECK ((group_id IS NULL) = (lane_index IS NULL));

CREATE INDEX idx_space_hotspots_group_id ON space_hotspots (group_id) WHERE group_id IS NOT NULL;
