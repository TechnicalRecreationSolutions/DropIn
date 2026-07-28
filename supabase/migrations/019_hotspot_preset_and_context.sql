-- =============================================================================
-- Migration 019: Hotspot preset identity + map context elements
-- =============================================================================
-- Two additions serving the illustrated facility-map renderer:
--
-- 1. space_hotspots.preset_key — which preset (see
--    src/lib/facility-shapes/presets.ts) a shape was placed from. Until now
--    the preset was deliberately discarded after seeding a shape's initial
--    size, which is exactly why every space rendered as an anonymous
--    rectangle: the renderer had no way to know a shape is a pool vs. a
--    basketball court vs. a room. The key is an app-level identifier, not an
--    FK — the preset list is a small fixed array in code with no DB table,
--    and an unrecognized key (e.g. a preset later renamed) must degrade to
--    the generic room rendering rather than break a constraint. Backfill:
--    grouped rows are necessarily pool lanes (multi-lane pools are the only
--    presets that create groups), so they get a pool key — WHICH pool key
--    doesn't matter, because rendering derives lane count from the group's
--    current row count (see 018), never from the preset. Standalone rows
--    can't be identified in hindsight and fall back to the generic room.
--
-- 2. map_context_elements — non-interactive scenery that makes the diagram
--    read as a building instead of shapes floating in a void: labeled zones
--    ("Lobby", "Change Rooms") and an entrance marker. Deliberately a
--    sibling table rather than more nullable columns on space_hotspots:
--    context elements have no space_id, no live status, no lane grouping,
--    and are never tappable, so giving them a nullable-space hotspot row
--    would poison every space_id join and status lookup with "is this row
--    real?" checks. Same normalized 0..1 geometry as hotspots so the
--    renderer treats placement identically.
-- =============================================================================

ALTER TABLE space_hotspots
  ADD COLUMN preset_key TEXT NOT NULL DEFAULT 'generic-large';

UPDATE space_hotspots SET preset_key = 'pool-6lane-25m' WHERE group_id IS NOT NULL;

CREATE TABLE map_context_elements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_map_id UUID NOT NULL REFERENCES facility_maps(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('zone', 'entrance')),
  -- Normalized 0..1 fractions of facility_maps.canvas_width/canvas_height,
  -- identical to space_hotspots (see 016).
  x               NUMERIC NOT NULL CHECK (x >= 0 AND x <= 1),
  y               NUMERIC NOT NULL CHECK (y >= 0 AND y <= 1),
  width           NUMERIC NOT NULL CHECK (width > 0 AND width <= 1),
  height          NUMERIC NOT NULL CHECK (height > 0 AND height <= 1),
  rotation        NUMERIC NOT NULL DEFAULT 0 CHECK (rotation >= 0 AND rotation < 360),
  -- Zone display name ("Lobby"); optional for entrances (default "Entrance" in UI).
  label           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE map_context_elements ENABLE ROW LEVEL SECURITY;

-- Mirrors space_hotspots policies (016): public read when the parent map is
-- published; full CRUD for org members; superadmin override.
CREATE POLICY "map_context_elements_public_read_published"
  ON map_context_elements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM facility_maps m
      WHERE m.id = facility_map_id AND m.is_published = TRUE
    )
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

CREATE POLICY "map_context_elements_members_crud"
  ON map_context_elements FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "map_context_elements_superadmin_all"
  ON map_context_elements FOR ALL
  USING (public.is_superadmin());

CREATE INDEX idx_map_context_elements_facility_map_id ON map_context_elements (facility_map_id);
