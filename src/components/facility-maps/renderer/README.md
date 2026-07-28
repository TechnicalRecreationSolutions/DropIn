# Facility Map Rendering Engine

`FacilityMapSvg` turns normalized hotspot rects into an illustrated facility diagram
("soft depth" visual language): gradient water with lane ropes, material courts with
per-sport markings, rounded ice, pale rooms — inside a building shell, with status
washes layered on top. It is the **only** place facility maps are drawn; the public
floorplan view and the admin builder both render through it, so the two can never
diverge.

## Files

| File | Role |
|---|---|
| `FacilityMapSvg.tsx` | The engine: viewBox math, gradient defs, building shell, unit z-ordering, dispatch to shape components. |
| `shapes.tsx` | One component per shape family (pool, leisure pool, courts, rink, gym floor, climbing wall, room) plus context scenery and shared label/status helpers. |
| `style.ts` | The palette (`MAP_COLORS`), shadows/glow, and the `preset_key → ShapeFamily` mapping. |
| `types.ts` | `RenderShape` / `RenderContextElement` / `SpaceStatusInfo` — the engine's input model, fed by both viewer and builder. |

## Geometry model

- Hotspots store **normalized 0..1 fractions** of the canvas; the canvas itself is
  real-world **meters** (`facility_maps.canvas_width/height`).
- The SVG viewBox is a fixed **1000 units wide** (height follows the canvas aspect
  ratio), so stroke widths and radii are consistent fractions of the rendered map
  across facilities of any physical size.
- **Text is sized against rendered pixels, not viewBox units.** An internal
  ResizeObserver measures `pxPerUnit`; `fsUnits(desiredPx, pxPerUnit, capUnits)`
  converts a target on-screen size back into viewBox units. Without this, phone-size
  maps get 5 px labels.
- **Detail density degrades before it smudges**: court/rink markings, lane session
  text, and status lines each have a minimum rendered-pixel gate.
- Rotation is applied per shape group (`rotate(deg cx cy)`); labels counter-rotate
  around their anchor so text stays horizontal at any shape angle.
- Units (standalone shapes and lane groups) render sorted **large → small**, so a
  studio overlapping a pool stays visible and clickable.

## Status layers

`statusBySpaceId` maps space id → `{ status: "live" | "soon", title, timeLabel }`;
absence means free. Live uses the org accent (`--org-accent`); "soon" uses a fixed
amber — except on water, where an amber wash blends to muddy green, so water
brightens with warm white + amber border instead. The live glow is a CSS
`drop-shadow` with `color-mix` on the accent variable (no SVG filter elements — their
`flood-color` handles CSS variables inconsistently).

## Adding a preset

1. Add the preset to `src/lib/facility-shapes/presets.ts` (real-world meters;
   `laneCount > 1` only for lane-striped pools).
2. Map its key in `shapeFamily()` (`style.ts`) — prefix matching preferred, so size
   variants of an existing family need no code change at all.
3. If it's a **new family**: add a component to `shapes.tsx` (copy the closest
   existing one; keep the `StatusOverlay` + `LabelBlock` + `SelectionRing` trio and a
   pixel gate for any fine detail) and a dispatch case in `FacilityMapSvg`.
4. **No preset without a face** — never add a preset that would fall through to the
   generic room rendering; recognition is the whole point.

Unrecognized `preset_key` values (e.g. a renamed preset in old rows) intentionally
degrade to the generic room rather than throwing — the key is app-level data with no
DB constraint (see migration 019).

## Non-interactive mode

Omit `onSpaceClick` and the map renders inert — that's what the builder canvas does
(its editing overlay handles input) and what the publish-preview modal shows.
