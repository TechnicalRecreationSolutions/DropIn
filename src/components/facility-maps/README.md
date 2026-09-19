# Facility Maps

The facility map is Dropin's recognition-first answer to schedule jargon: instead of
making a visitor decode "Lane 3 · SC Adv", it shows them an illustrated diagram of the
building — water that looks like water, courts with their markings — with live status
layered on top. A first-time visitor finds their session by sight, not vocabulary.

There are two experiences built on one rendering engine:

| Piece | Where | What it does |
|---|---|---|
| **Builder** (`MapEditorClient`, `ShapeCanvas`, `ShapePalette`, `MapSpacesPanel`) | Dashboard → Map (`/dashboard/map`) | One toolbar (undo/redo, preview, save, publish), then the canvas beside a sticky two-tab sidebar: **Spaces** lists the building's spaces grouped exactly like the Spaces page (department → zone, via `lib/spaces/grouping.ts`) and marks each one placed or not; **Add shape** is the preset palette. |
| **Viewer** (`src/components/schedule/FloorplanView.tsx` + `FloorplanLegend.tsx`) | Public schedule "floorplan" template + widget embeds | Visitors see the map with live/soon/free status and transition alerts, a legend panel (heads up / on now / up next), tap a space for details, and preview other times today. |

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

- **The map is a picture of the Spaces page** — the sidebar groups spaces with the
  same `buildSpaceSections` the Spaces page uses, so a space sits in the same
  department and zone on both. Placed spaces select their shape (and a canvas click
  selects the space in the list — selection is controlled by `MapEditorClient`, keyed
  by `unitKeyOf`). **Place** on an unplaced space targets the next preset at that
  space (lane 1 for a pool), one-shot.
- **Labels default to the space name** — new shapes save `label = null`, so renaming
  a space on the Spaces page renames it on the map. The label field is an override
  only. (Shapes placed before 2026-09-18 carry a copied-in label; clearing the field
  reverts them to the space name.)
- **Tap-to-arm placement** — tapping a card in `ShapePalette` arms it (`placement.ts`'s
  `ArmedPlacement`); `ShapeCanvas` then shows a live dashed sizing ghost under the
  cursor/finger and places on the next background tap there, computed by the shared
  `placementRect()` helper so the preview never lies about where a shape lands.
  Placement stays armed after a drop so several of the same shape can be placed in a
  row; the palette card toggles it off, as does Escape (global, not just
  canvas-focused) or arming something else. Replaced an earlier press-and-drag gesture
  that required dragging across the whole viewport to the canvas — unreliable on
  mobile — and that hid a preset's real-world dimensions behind a hover `title`,
  which never fires on touch.
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
  Rules live in `src/lib/floorplan/spaceStatus.ts` (pure; tested by verify-an).
- **Transition alerts** sit on top of the status, as a burnt-orange outline plus a tag
  pill — deliberately not a new fill: **changeover** (live session ends within 15 min
  and another starts in that space within 15 min of it: "→ Aquafit 7:30 PM"),
  **ending** ("Ends in 6 min"), **starting** ("Starts in 12 min"). A tag too wide for
  its shape falls back to a short form ("→ 7:30 PM", "Ends 6m").
- **Legend panel** (`FloorplanLegend`): color key, then Heads up / On now / Up next,
  one row per session occurrence (a lesson across six lanes is one row). Beside the
  map when the container is ≥ 56rem wide, under it otherwise — a container query,
  because the same view runs full-page, in a narrow widget iframe, and on a big screen.
- The time control previews any time today; leaving "now" is deliberately loud (amber
  handle and "Viewing 7:30 PM" readout) so a previewed evening is never mistaken for
  the present.
- The summary strip above the map is the at-a-glance count; the legend has the detail.
- Tapping a space opens `SpaceDetailSheet` — live session with cost and age/skill,
  plus "Next up here" with start time and price.
