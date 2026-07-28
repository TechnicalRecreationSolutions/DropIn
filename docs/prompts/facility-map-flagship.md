# Prompt: Facility Map — Flagship Redesign

Copy everything below the line into a fresh Claude Code session run from `C:\ForRec\dropin`.

---

## The mission

The facility map is Dropin's flagship feature, and right now it doesn't look like one. Your job is to redesign it — the public viewer first, the admin builder second — until it is the most polished, most obviously-valuable screen in the product. This is a real production app headed for a professional audit and app-store deployment; the bar is "a facility manager sees this and wants it on a TV in their lobby."

## Why this feature matters (internalize this before designing)

Schedules speak insider language. "Lane 3 — SC Adv", "Studio B — HIIT45", "Court 2 — Open Gym" mean nothing to a first-time visitor, a parent dropping off a kid, or a tourist looking for a lap swim. The facility map inverts the problem: instead of making people decode words, it shows them a picture of the building. You recognize the big pool, you tap it, you learn what's happening there right now and whether you can join. It converts "I don't understand this schedule" into "I can see exactly where to go." Every design decision should serve that recognition-first promise: someone with zero context, on a phone, in a lobby, finds their session in under ten seconds.

## Current state (read these before touching anything)

The feature exists end-to-end but reads as a wireframe, not a product:

- **Schema**: `supabase/migrations/016_facility_maps.sql` — `facility_maps` (blank canvas sized in meters) + `space_hotspots` (normalized 0..1 rects with rotation, optional label, group_id/lane_index for multi-lane pools). One published map per facility. RLS in place.
- **Builder**: `src/components/facility-maps/` — `MapEditorClient`, `ShapeCanvas`, `ShapePalette`. Admins drag presets from `src/lib/facility-shapes/presets.ts` (pools, courts, generic rooms with real-world meter dimensions) onto a blank canvas, then move/resize/rotate/relabel and publish.
- **Viewer**: `src/components/schedule/FloorplanView.tsx` + `HotspotPopover.tsx` + `TimeScrubber.tsx`. Absolute-positioned `<div>`/`<button>` rectangles: gray borders, gray fill, blue tint + dot when a session is live, a click popover, and a vertical time scrubber to explore any time today.
- **Surfaces**: the `"floorplan"` schedule template in `src/components/schedule/ScheduleView.tsx`, the embeddable widget (`src/app/widget/[orgId]/page.tsx`, single-facility only), and `WidgetConfigurator`. Live-status logic is shared via `src/lib/utils/sessionStatus.ts` — keep it shared.

What's wrong, concretely:

1. **Every space looks identical.** A 25m pool, a basketball court, and a storage-closet-sized studio are all flat gray rectangles. The whole point is recognition, and there is nothing to recognize.
2. **No facility context.** Shapes float on a void — no walls, entrance, lobby, change rooms, or any anchor that tells you which way you're facing when you walk in.
3. **Status is a dot.** "Live" is a subtle tint plus a 3px dot. It should be impossible to miss what's happening, what's next, and what's free.
4. **Rotation rotates the labels**, small text truncates, and div-based rendering caps us at axis-ish rectangles forever.
5. **The builder feels like a debug tool** — no snapping/alignment guides, no undo, no visual resemblance between what admins build and what visitors see.
6. **Mobile is untested territory**, and mobile is the primary context (lobby, phone in hand).

## Design principles (these are the spec for every decision)

1. **Recognition before reading.** A space should be identifiable by its illustration alone — water reads as water, a court reads as a court — before any label is parsed.
2. **The map is live, not decorative.** Status (happening now / starting soon / free) is the primary visual layer, legible from across a room. A glowing pool with "Aqua Fit · ends 7:45" beats a gray box with a dot.
3. **Mobile-first, TV-worthy.** Design for a phone held in a lobby; verify it also scales up beautifully, because a facility will eventually put this on a lobby display.
4. **What admins build is what visitors see.** Builder canvas and public viewer share one rendering engine — the admin's reward for finishing the map is seeing the beautiful thing itself.
5. **Zero-context usable.** No training, no legend-studying required; the legend confirms what the visuals already said.
6. **Professional restraint.** Illustrated ≠ cartoonish. Think airport/stadium wayfinding maps: soft depth, confident color, disciplined type, org accent-color theming via the existing `--org-accent` variable.

## Scope of work

### A. Shared SVG rendering engine (the foundation)

Replace the absolute-positioned div rendering with a single SVG-based facility renderer used by both `FloorplanView` and the builder canvas.

- One component per shape family, keyed off the preset taxonomy: pools get water fill, lane ropes, and per-lane status; each court type gets its real markings (center circle, key, service boxes — simplified, not regulation-diagram-fussy); generic rooms get a clean floor treatment and icon.
- **Persist the preset key on `space_hotspots`** (new migration; backfill existing rows to a sensible generic). Today the preset is discarded after placement, which is exactly why everything renders as an anonymous rectangle. Follow the existing migration conventions in `supabase/migrations/` including RLS review.
- Labels stay horizontal and legible regardless of shape rotation; scale type and detail density with rendered size (a tiny badminton court on a phone drops its markings before it drops its name).
- Add optional non-interactive **context elements** (walls/outline, entrance marker, labeled zones like Lobby / Change Rooms) — a new hotspot kind or a sibling table, your call, but justify it in the migration comments.
- Status layers on every space: **live now** (strong accent fill + session name + end time), **starting soon** (defined threshold, softer treatment), **free** (quiet but inviting, not dead-gray). Respect `prefers-reduced-motion` for any pulse/animation.

### B. Visitor experience (`FloorplanView` and its surfaces)

- Rebuild the interaction for touch: tapping a space opens a **bottom sheet on mobile** (popover is fine on desktop) with session details, time remaining, capacity, and the drop-in price/CTA where applicable — reusing existing session-detail patterns rather than inventing parallel ones.
- Rework the **time scrubber** into something self-explanatory on a phone (the current vertical drag track is cramped): consider a horizontal scrubber or "Now / +1h / tonight" quick chips with fine scrub on demand. Scrubbing anywhere except "now" must be unmistakably labeled so nobody thinks a 9pm class is happening at noon.
- Add a compact **legend / status summary** ("3 sessions on now · 2 starting within the hour") that doubles as a filter or attention-director.
- Design the **empty and unpublished states** properly (public: graceful fallback to another template; admin preview: a real preview, not the raw viewer).
- Verify the widget embed path (`/widget/[orgId]` with a facility) renders the new viewer correctly inside an iframe at small sizes.

### C. Builder experience (`MapEditorClient`, `ShapeCanvas`, `ShapePalette`)

- The canvas renders through the same engine, so admins manipulate the real illustrated shapes.
- Editing ergonomics: snap-to-grid and alignment guides, keyboard nudging, multi-step **undo/redo**, duplicate, and clearly discoverable rotate/resize handles that work on touch.
- Smooth the **space-assignment flow** — placing a 6-lane pool when spaces don't exist yet should offer to create them inline, not error out with "add more spaces first."
- A **guided first-run**: pick facility type → suggested starting layout → adjust → publish. Target: a non-technical facility manager builds a credible map in under five minutes.
- Publish flow shows a true visitor preview (mobile-width frame) before going live.

### D. Documentation and quality

- Update/author READMEs for `src/components/facility-maps/` and the schedule floorplan pieces, and an architecture note on the rendering engine (where shape definitions live, how to add a new preset).
- Extend `presets.ts` thoughtfully (e.g., climbing wall, ice rink, track, gym floor, studio) only alongside their illustrated renderings — no preset without a face.

## Constraints

- Mobile-first is a hard requirement across both viewer and builder.
- Keep the normalized-coordinate schema approach; additive migrations only, with the same documentation rigor as `016_facility_maps.sql`. All new tables/columns get RLS parity.
- Keep `getSessionLiveStatus` as the single source of "on now" truth across all schedule views.
- No new heavyweight dependencies without justification; prefer hand-rolled SVG over a canvas/graphics library unless you can argue the library earns its bundle weight.
- This Next.js version has breaking changes — read the relevant guides in `node_modules/next/dist/docs/` before writing code (per AGENTS.md).
- Work in phases with a commit per phase, each verified end-to-end in the running app (builder → publish → public viewer → widget embed) before moving on. Do not mark anything done on the strength of a compiling build.

## Process

1. Start by reading everything listed in "Current state," then present a phased plan (Phase 1: rendering engine + persisted preset key; Phase 2: visitor experience; Phase 3: builder; Phase 4: polish/docs — adjust as you see fit) before writing code.
2. For the visual language, mock 2–3 stylistic directions for the pool + basketball court renderings (as quick HTML/SVG samples I can open) and let me pick before you build out the full shape library.
3. After each phase, run the app and screenshot the result on a mobile viewport.

## Definition of done

- A stranger shown the map on a phone can answer "where is something happening right now, and what is it?" without instruction.
- Pools, every court type, and rooms are visually distinct and attractive at phone size; labels never rotate or truncate into uselessness.
- Live/soon/free status is legible at arm's length; scrubbed time is never mistakable for "now."
- An admin can build and publish a professional-looking map for a typical rec center in under five minutes, with undo, snapping, and inline space creation.
- Builder and viewer render identically; widget embed verified; empty/unpublished states designed; reduced-motion respected; interactive elements keyboard-accessible with sensible ARIA labels.
- Migrations documented with RLS parity; component READMEs and an architecture note for the rendering engine are in place.
