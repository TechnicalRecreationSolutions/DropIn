# Prompt — make the schedule canvas gestures feel production-ready

Run this against `src/components/schedule/` (the Map view and `editing/`),
`src/lib/schedule/gridEdits.ts` and `src/app/api/sessions/batch/route.ts`.
Repeat it until the stop condition at the bottom is met. One pass fixes one
coherent group and ends green.

## What is already true

The lane x time canvas works: click/shift/Ctrl-click selection, drag to move
between lanes and times, edge-drag to resize, a corner handle that extends a
session across lanes, Ctrl-C/X/V/D, Delete, Alt for a single date, and
Ctrl-Z/Ctrl-Shift-Z over a server-computed inverse. `verify-aw` passes 99/99.

So this is **not** a prompt about whether the gestures work. It is about whether
they feel like a tool someone uses for two hours building a season, rather than
a demo that happens to pass its tests.

## The standard

The user the canvas is for already has a working tool: a hand-built lane-by-time
Excel sheet. Every gesture here is competing with one they already know. A
gesture that works but hesitates, or that lands somewhere they did not aim, is
worse than the spreadsheet, because the spreadsheet never lies about what is
about to happen.

So judge every gesture on this, in this order:

1. **It never lies.** What is drawn during the gesture is what will be written.
   No block that shows one position and saves another. No "success" over a write
   the server silently narrowed.
2. **It never hesitates.** The result is on screen at pointer-up, not after a
   round trip. A schedule that snaps back to the old position for 400ms and then
   jumps to the new one reads as a failed drag that somehow worked.
3. **It says where it will land before you commit.** A drop, a resize, a paste
   all have a target; the target is visible and carries its value (the time, the
   lane) while the pointer is still down.
4. **It is reachable without a mouse.** Every gesture has a keyboard route, and
   the focused thing is visibly focused.
5. **It survives being wrong.** A refused write puts the block back where it was
   and says why, in one sentence naming the thing in the way.

## The rubric

Audit each pass. For every item: state whether it currently holds, and if not,
whether fixing it is this pass's coherent group.

### A. Feedback during the gesture

- A1. The dragged block follows the pointer, and what follows it is legible
  (name + the time it would land on), not a ghost of the source.
- A2. The drop target is visibly the drop target — the lane column and the
  minute row, not just the column.
- A3. A resize shows the new start/end **as times**, continuously, near the edge
  being dragged.
- A4. Snapping is visible. If the grain is 15 minutes, the preview moves in
  15-minute steps and the user can see that it is doing so deliberately.
- A5. Dragging one block of a multi-selection shows **all** of the selection
  moving, not just the one under the pointer.

### B. Latency and truth

- B1. The result is on screen at pointer-up (optimistic), and reconciles with
  the server's answer when it arrives.
- B2. A failure restores the pre-gesture position exactly, and the message names
  the conflict rather than saying "could not apply this change".
- B3. A write the server *narrowed* (058's `timesIgnored`, a lane collapse) is
  visible as such, not as a partial success the user has to notice.
- B4. Nothing is written twice by a double-fire (pointerup + click, a second
  Ctrl-V while the first is in flight).

### C. Hit targets and pointer ergonomics

- C1. A short block (15-30 minutes) is still draggable — its resize handles must
  not consume the whole block.
- C2. Handles are large enough to hit without precision, and their cursor says
  what they do.
- C3. The fill/lane handle cannot be confused with the resize handles.
- C4. Hovering a block does not shift the layout.
- C5. Dragging near the edge of the scroll container scrolls it.

### D. Keyboard and accessibility

- D1. A block can be focused and selected from the keyboard.
- D2. Arrow keys move the selection; a modifier resizes it. Enter opens details.
- D3. Selection state is exposed to assistive tech (`aria-selected` or
  equivalent), not only as a ring.
- D4. Every gesture's result is announced once, not on every frame.
- D5. Focus is not lost when a write re-renders the canvas.

### E. Legibility of consequence

- E1. The scope line on the undo bar is always present and always correct
  ("every Tuesday", "this week only", "the whole recurring series").
- E2. A destructive gesture (Delete, a paste over something) is distinguishable
  at a glance from a positional one.
- E3. The undo bar does not cover the thing it is talking about.
- E4. A session that cannot take a gesture (follows operating hours, a residual
  slice) says so when you try, rather than offering a grip that does nothing.

### F. Touch

- F1. Selection, move, resize and lane-span all work with a finger.
- F2. Touch targets meet the 44px guidance, or the gesture has a non-touch
  alternative that is reachable.
- F3. A drag does not fight the page scroll.

## Hard constraints

- **The read-only path must not change.** `WeeklyScheduleMap` renders the public
  widget and facility page with no canvas above it. Anything added here is
  behind `canvas?.enabled`, and the widget must not pay for it.
- **No new migration.** This is presentation and interaction.
- **Do not weaken the series/occurrence distinction.** A block is one day of one
  lane of a recurring series, and every gesture's scope stays legible.
- **Do not reintroduce a confirmation dialog** to solve a feedback problem. The
  answer to "the user was surprised" is better feedback before and better undo
  after, not a modal.

## The gate, every pass

```bash
npx tsc --noEmit
npx eslint src
node --experimental-strip-types scripts/verify/verify-aw.mjs
```

All three clean, and the harness gains an assertion for anything newly
assertable. A change to behaviour that no assertion covers is not finished.
Falsify at least one new assertion per pass to prove it is sensitive.

## Stop condition

Stop when every rubric item either holds or is written down in
`docs/RESUME.md` as a deliberate gap with its reason — and when a pass produces
no item worth fixing that is not already on that list.
