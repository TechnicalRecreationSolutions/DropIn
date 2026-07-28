# Facility Maps

The facility map is Dropin's recognition-first answer to schedule jargon: instead of
making a visitor decode "Lane 3 · SC Adv", it shows them an illustrated diagram of the
building — water that looks like water, courts with their markings — with live status
layered on top. A first-time visitor finds their session by sight, not vocabulary.

There are two experiences built on one rendering engine:

| Piece | Where | What it does |
|---|---|---|
| **Builder** (`MapEditorClient`, `ShapeCanvas`, `ShapePalette`) | Dashboard → Facility → Map tab | Admins drag presets and context scenery onto a canvas, arrange them, and publish. |
| **Viewer** (`src/components/schedule/FloorplanView.tsx`) | Public schedule "floorplan" template + widget embeds | Visitors see the map with live/soon/free status, tap a space for details, and preview other times today. |

Both draw through **`renderer/FacilityMapSvg`** — see [`renderer/README.md`](./renderer/README.md)
for the engine's architecture and how to add a new preset. Because there is one renderer,
"what admins build is what visitors see" holds by construction.

## Data model (migrations 016, 018, 019)

- `facility_maps` — one canvas per facility (real-world meters), at most one published.
- `space_hotspots` — placed shapes: normalized 0..1 rect + rotation, a `preset_key`
  selecting the illustration, an optional label override, and `group_id`/`lane_index`
  for multi-lane pools (every row in a group carries the identical outer rect; lane
  count is the group's row count).
- `map_context_elements` — non-interactive scenery (labeled zones, entrance marker).
  Deliberately a sibling table: context has no space, no status, no lanes.

## Builder behaviors worth knowing

- **Inline space provisioning** — placing a preset that needs more Spaces than exist
  creates them automatically (unpublished, named "Lane N" for lanes). No dead-end
  "add spaces first" error.
- **Serial placement queue** — placements await network calls, so they run through a
  queue and commit functional updates against a live ref; two quick drops must not
  interleave their space-provisioning (see the comments in `MapEditorClient`).
- **Undo/redo** — one snapshot per completed gesture or atomic edit (`onCommit`),
  never per drag frame. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y.
- **Snapping** — 0.5 m grid plus other shapes' edges/centers (alignment guides), 15°
  rotation steps. Keyboard: arrows nudge 0.1 m (Shift = 0.5 m), Delete, Ctrl+D
  duplicate, Escape deselect.
- **Publish guard** — an unpublished Space is dropped from the public sessions join,
  so its hotspot could never show live status. Publishing a map that references
  unpublished spaces offers to publish them together.

## Viewer behaviors worth knowing

- Status per space at the viewed time: **live** (org-accent wash + session + end time),
  **soon** (amber, starting within 60 min), **free** (plain material). Live wins.
- The time control previews any time today; leaving "now" is deliberately loud (amber
  handle and "Viewing 7:30 PM" readout) so a previewed evening is never mistaken for
  the present.
- The summary strip above the map doubles as the status color legend.
- Tapping a space opens `SpaceDetailSheet` — live session with cost and age/skill,
  plus "Next up here" with start time and price.
