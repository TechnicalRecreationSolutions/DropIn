-- =============================================================================
-- Migration 016: Facility Maps (shape-based diagram builder)
-- =============================================================================
-- Orgs build a from-scratch diagram of a facility by dragging in preset
-- shapes (e.g. "6-lane 25m pool", "basketball court" — see
-- src/lib/facility-shapes/presets.ts) sized to correct real-world
-- proportions, then freely move/resize/rotate/relabel them. Each placed
-- shape links to an existing Space (see 012_spaces.sql). Visitors viewing
-- the public schedule can tap a shape to see what's live there right now —
-- a visual alternative to picking a space by name for people who don't know
-- what "Lane 3" or "Dive Tank" refers to but would recognize it on sight.
--
-- There is no background photo — facility_maps.canvas_width/canvas_height
-- (in meters) describe the blank diagram's real-world extent, so preset
-- shapes (also defined in meters) can be placed at true relative scale with
-- no separate conversion layer between "preset size" and "canvas size."
--
-- The schema allows multiple maps per facility (a space could reasonably
-- appear on more than one), but v1 only ever shows one: the unique partial
-- index below enforces at most one *published* map per facility, so the
-- public page never needs a map-picker UI. That constraint can be dropped
-- later without a schema change if multi-map support is needed.
--
-- space_hotspots stores rectangles as coordinates normalized to 0..1
-- fractions of the map's canvas dimensions, not raw meters, so a shape
-- stays correctly positioned however large the canvas is rendered (mobile
-- vs. desktop) without any resize bookkeeping. A shape's preset origin
-- (e.g. "6-lane 25m pool") is only used to seed its initial width/height at
-- placement time — it is NOT persisted here, since once placed a shape is
-- just rect + rotation + label, free to be resized away from its preset's
-- aspect ratio.
-- =============================================================================

CREATE TABLE facility_maps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT 'Facility Map',
  canvas_width    NUMERIC NOT NULL DEFAULT 25 CHECK (canvas_width > 0),
  canvas_height   NUMERIC NOT NULL DEFAULT 15 CHECK (canvas_height > 0),
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- v1 simplification: at most one published map per facility.
CREATE UNIQUE INDEX idx_facility_maps_one_published
  ON facility_maps (facility_id) WHERE is_published = TRUE;

CREATE TABLE space_hotspots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_map_id UUID NOT NULL REFERENCES facility_maps(id) ON DELETE CASCADE,
  space_id        UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  shape           TEXT NOT NULL DEFAULT 'rect' CHECK (shape = 'rect'),
  -- Normalized 0..1 fractions of facility_maps.canvas_width/canvas_height.
  x               NUMERIC NOT NULL CHECK (x >= 0 AND x <= 1),
  y               NUMERIC NOT NULL CHECK (y >= 0 AND y <= 1),
  width           NUMERIC NOT NULL CHECK (width > 0 AND width <= 1),
  height          NUMERIC NOT NULL CHECK (height > 0 AND height <= 1),
  -- Degrees clockwise, pivot = shape center.
  rotation        NUMERIC NOT NULL DEFAULT 0 CHECK (rotation >= 0 AND rotation < 360),
  -- Optional display label override — falls back to the linked space's name when null.
  label           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (facility_map_id, space_id)
);

ALTER TABLE facility_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_hotspots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facility_maps_public_read_published"
  ON facility_maps FOR SELECT
  USING (is_published = TRUE OR org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

CREATE POLICY "facility_maps_members_crud"
  ON facility_maps FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "facility_maps_superadmin_all"
  ON facility_maps FOR ALL
  USING (public.is_superadmin());

CREATE POLICY "space_hotspots_public_read_published"
  ON space_hotspots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM facility_maps m
      WHERE m.id = facility_map_id AND m.is_published = TRUE
    )
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

CREATE POLICY "space_hotspots_members_crud"
  ON space_hotspots FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "space_hotspots_superadmin_all"
  ON space_hotspots FOR ALL
  USING (public.is_superadmin());

CREATE INDEX idx_facility_maps_facility_id ON facility_maps (facility_id);
CREATE INDEX idx_space_hotspots_facility_map_id ON space_hotspots (facility_map_id);
CREATE INDEX idx_space_hotspots_space_id ON space_hotspots (space_id);
