# Schedule editing layer

Turns the **public** schedule views into editors without forking them.

`WeeklyScheduleGrid`, `WeeklyScheduleList`, and `WeeklyScheduleMap` (in the parent
`schedule/` folder) are single components used by three surfaces: the embeddable widget, the
public facility page, and the dashboard command centre. The only difference between viewing
and editing is whether a `ScheduleEditingProvider` is mounted above them.

```
widget / public page          dashboard command centre
  <ScheduleView/>               <ScheduleEditingProvider value={api}>
      ↓ context = null            <ScheduleView/>
  read-only                     </ScheduleEditingProvider>
                                  ↓ context = api
                                grows "+" buttons, ⋯ menus, drag-and-drop
```

This replaced a parallel `schedule-builder/` folder that duplicated each view. Duplicates
drift; a shared component can't. "What staff build" and "what visitors see" are now the same
code path by construction, which is the whole promise of the command centre.

## What each view gains under a provider

| View | Gains | Why that shape |
|---|---|---|
| Grid | "+" in each day header, ⋯ menu per card | No time axis, so a new session picks its time in the dialog |
| List | "Add session" per day heading, ⋯ menu per row | Same — a flat list has no position to drop onto |
| Map | Everything above, **plus** a column per facility space (including empty ones) and real drag-and-drop | Only view with a spatial position: vertical offset → start time, column → space |
| Floorplan | Nothing | It's a status-at-a-time diagram; its editor is the facility Map tab |

Map is also the only view that mounts a `DndContext`, and only when editing — a read-only
widget never pays for dnd-kit's listeners.

## Files

| File | Role |
|---|---|
| `ScheduleEditingContext.tsx` | The `ScheduleEditingApi` contract + `useScheduleEditing()`. Returns `null` when read-only, which is the check every view branches on. |
| `SessionActionsMenu.tsx` | The ⋯ overlay (Edit details / Duplicate / Remove series). Deliberately an *overlay* so the card underneath stays byte-identical to the public one. |
| `ScheduleDndProvider.tsx` | The single `DndContext`, plus the drop handler. Must wrap **both** the rail and the schedule panel — see below. |
| `TemplateRail.tsx` | Session templates — dnd-kit drag sources in Map, click-to-place shortcuts elsewhere. |
| `CreateSessionDialog.tsx` | One dialog for every placement entry point; pre-fills whatever the view knew (day, space, time, template). |
| `DuplicateSessionDialog.tsx` | "Same session, different lane/day" fast path. |
| `RescheduleConfirmDialog.tsx` | Confirms a Map drag before it writes. |
| `DeleteSessionDialog.tsx` | Confirms removing a whole series. |

## The DndContext has to live above both sides

The template rail is a **layout sibling** of the schedule panel, not a child of it. A
`DndContext` mounted inside `WeeklyScheduleMap` therefore leaves the rail's `useDraggable`
outside any provider, where dnd-kit silently no-ops — the card never picks up, no error is
thrown, and nothing in the console hints at why. `ScheduleDndProvider` exists to make that
impossible: the command centre wraps rail + panel in it together.

The drop handler lives there too rather than in Map, which it can, because it needs nothing
from Map's state — the droppable carries its space and day in `data`, and converting a drop's
vertical offset to a start time is a pure function of the shared week geometry.

## Things worth knowing

- **Sessions are RRULE series, not occurrences.** Dragging or deleting one visible block
  changes/removes the entire recurring series, so both actions confirm first rather than
  writing silently — *on the dialog path*. The staff Map view no longer takes that path;
  see [The canvas](#the-canvas-spreadsheet-editing-on-the-map-view), where the same fact is
  carried by an undo bar that names the scope instead.
- **`canCreate` is false when the scope spans schedules.** A new session needs exactly one
  `schedule_group_id`, so the command centre's "All schedules" mode stays view + duplicate +
  delete only.
- **Duplicating uses the session's own `scheduleGroupId`**, not the currently-selected one —
  otherwise duplicating from an all-schedules view would silently reparent the copy.
- **Templates carry `default_space_ids`** via the `session_template_spaces` join, so the
  create dialog can pre-select the spaces a template usually occupies.
- The provider's `value` is memoized in `ScheduleCommandCentre`; passing a fresh object each
  render would re-render every session block on every keystroke in a dialog.

---

## The canvas: spreadsheet editing on the Map view

Under a staff audience the Map view is a second thing as well as a view — a
lane x time canvas with selection, a clipboard, resize handles and an undo
stack. It is what the customer actually builds a schedule in today: Commonwealth
Pool's real working document is a hand-made lane-by-time Excel sheet
(`docs/RESUME-internal-view.md`), and every gesture below exists because that is
the gesture they already have.

```
ScheduleCanvasProvider  (staff + Map only)
├── ScheduleCanvasContext   selection, active cell, clipboard, gestures -> ops
├── useScheduleBatch        POST /api/sessions/batch, and the undo/redo stack
├── useCanvasKeyboard       Ctrl-C/X/V/D, Delete, Ctrl-A, Ctrl-Z/Y, Escape
├── CanvasUndoBar           what just happened, how far it reached, Undo
├── CanvasSelectionChip     what is selected right now, in the toolbar strip
└── CanvasShortcutList      every gesture, inside the week panel's help tab
```

`ScheduleEditingApi` answers "may this be edited, through which dialogs".
`ScheduleCanvasApi` answers the separate question direct manipulation raises:
"what is selected, and what does the next gesture do to it". Two contexts, not
one — the list and grid views are editable and are not canvases, and keeping
selection out of the editing API leaves the widget's read-only render path
untouched.

### Why the confirmation dialogs are gone here

`RescheduleConfirmDialog` exists because a block is a whole RRULE series. A
spreadsheet does not confirm; it undoes. So on the canvas the write lands
immediately and `CanvasUndoBar` carries the account of it, including the scope
line — "every Tuesday", "this week only", "the whole recurring series". That
line is the dialog's job, moved after the fact. **Do not drop it**: "Moved
Lengths Swimming" on its own is the silent series-wide edit the dialog existed
to prevent.

The dialogs are still mounted and still used everywhere else — the Grid and List
views, and the Map view whenever the canvas is off.

### An edit replaces; it never collapses

This is the rule the whole thing turns on, and it lives in
`src/lib/schedule/gridEdits.ts`.

A series can run on several days and hold several lanes. The block on screen is
ONE day of ONE lane of it. So dragging the Wednesday block of a Mon/Wed/Fri
series to Thursday writes `BYDAY=MO,TH,FR`, and dragging the Lane 2 block of a
Lanes 1-4 session to Lane 6 writes lanes 1, 6, 3, 4.

`ScheduleCommandCentre.handleConfirmReschedule` — the dialog path — still does
the naive rebuild (`buildRRuleString({ days: [dropTarget] })`), which collapses
a three-day series to one day and resets `valid_from` to today. That was
survivable behind a dialog naming the series. It is not survivable behind a drag
that saves itself, which is why `moveDay`/`moveSpace` exist and why the server,
not the client, applies them: `ExpandedSession` does not carry the session's
rrule, so only the route can swap one day out of it.

### The undo is the server's, not the client's

`POST /api/sessions/batch` returns the ops that reverse what it just did, built
from the rows as they were at write time. `useScheduleBatch` stores that pair
and posts the other half; posting an undo returns *its* inverse, which is the
redo, so nothing here reasons about what redoing means.

A client-built inverse would be wrong the moment a following session's times are
discarded server-side (058), or a colleague saves the same session in between —
and it would be wrong by writing the local guess over their work.

> `verify-aw` §2 is the reason this works at all. The first run failed on it:
> Postgres hands `dtstart` back as `…+00:00` and `dtend_time` as `HH:MM:SS`,
> neither of which the route's own schema accepts, so every undo was rejected as
> invalid input. `toZulu()` in `src/lib/sessions/write.ts` normalises both.

### Gestures

| Gesture | What it writes |
|---|---|
| Click a block | Selects it. Shift-click takes the lane/time rectangle between two blocks; Ctrl-click toggles one. |
| Double-click | Opens `SessionModal`. On a read-only surface a *single* click still does, because there is nothing there to select into. |
| Drag a block | `move` — new lane, new time. Dropped on a day chip, the weekday instead. |
| Drag its top/bottom edge | `resize`. Hidden on a session that follows operating hours (058): it has no time of its own, so the grip would be one the server is required to ignore. |
| Drag the corner square sideways | Adds the crossed lanes to the *same* session — one session in Lanes 1-4, which is how the schema models a shared lap-swim block, not four copies. |
| Ctrl-C / Ctrl-X, Ctrl-V | Paste lands on the last-clicked cell and keeps the copied range's lane and minute offsets. A cut pastes as `move`s and is spent; a copy stays. |
| Ctrl-D | A copy of each selected block starting where it ends — the five-contiguous-blocks case `onAddAnotherTime` was built for. |
| Delete | The series, folded to distinct `sessionId`s first so a four-lane selection deletes once. |
| Alt + drag/resize | One date, via `session_exceptions`. Not the week — `POST /api/sessions/[id]/exceptions` is week-scoped, and using it here would retime Monday when Wednesday was dragged. |

### Things worth knowing

- **A residual fragment is never a cell.** `residualSegment.isSlice` blocks are
  derived slices; they render, and they are excluded from the canvas's block
  list entirely, because selecting one and pressing Delete would remove the
  whole session the slice came out of.
- **Alt across lanes or days is refused**, with a reason. An exception row can
  cancel or retime a date; it cannot move one to another lane.
- **The keyboard is bound at the window**, so it survives a click on the week
  navigator — and `shouldIgnore()` bails whenever *any* `role="dialog"` is in the
  document, not merely when the event target is inside one. The session modal
  opens with focus still on `body`, so the target check alone answers "no" while
  a dialog is squarely in the way.
- **The canvas is gated on `canEdit`, not `canCreate`.** Moving, resizing and
  deleting are useful in a schedule with no templates left to place; paste is
  what `scheduleGroupId: null` separately withholds.
- **`ScheduleDndProvider` tracks Alt at the window**, because dnd-kit's drag-end
  event carries no modifier state and the one that matters is whichever is held
  when the pointer is *released*.

### The feel pass, and what it cost to get right

`docs/prompts/canvas-gesture-polish.md` is the rubric these were audited
against. Four things it turned up are worth not re-learning:

- **dnd-kit's `transform` was never applied.** The block did not move at all
  during a drag — it faded, and jumped on refetch. `useDraggable` reports a
  transform; rendering it is a separate act.
- **`transition-all` on the block animated `top`/`height`/`transform`.** So a
  dragged block eased toward the pointer a beat behind it and a resize grew
  after the fact. Only the shadow is worth easing; geometry must never be.
- **Optimism has to describe what the SERVER will do.** A time drag writes
  `dtstart`, so every occurrence of the series moves — not just the one under
  the pointer. And `swapSpaceOnOccurrence` needs the same `from === to` guard
  `moveSpace` opens with, or a move *within* one lane optimistically strips the
  session's only space, the block jumps to the General column, its id changes
  with the column, and the selection is pruned out from under the next
  keypress.
- **`useDndMonitor` throws outside a `DndContext`** rather than degrading. It
  was added to `WeeklyScheduleMap` for the multi-select ghost and took down
  every read-only render of that component — the widget, the public facility
  page, and any aux staffer. The drag is published through the canvas context
  by whoever owns the DndContext instead. `verify-aw` §11 exists to catch this
  class of thing: it drives the same component as an `aux` staffer and asserts
  the grips, the handle and the shortcut bar are all absent and that a
  **single** click opens the details again.

Two overlap guards, for two different reasons:

- **Undo and redo refuse to overlap.** Held Ctrl-Z repeats faster than a round
  trip, and every press read the same `past`, posting one inverse repeatedly
  while popping the stack once per press. The row looked fine; the edit
  underneath became permanently unreachable.
- **Arrow presses coalesce** (`NUDGE_COALESCE_MS`) rather than refusing. Here
  the user *means* to repeat, so dropping presses would be wrong — but each
  press computed its target from a position the optimistic redraw had not yet
  published, so two presses asked for the same destination. Accumulating the
  delta also makes a held key one undo entry instead of thirty.

### Where the editing help lives

The left rail is for the things you **place** — session templates, and nothing
else. Everything you **consult** moved into the week panel
(`schedule-command/WeekPanel.tsx`), a right-hand sheet with two tabs:

| Tab | What | Opened from |
|---|---|---|
| Overview | What the week contains and how much of it — per-kind hours, open vs unprogrammed, per-day load | the **Overview** button in the toolbar strip |
| How to edit | `CanvasShortcutList` — every gesture, as a reference | the **How to edit** button, staff + Map only |

One piece deliberately did **not** move: `CanvasSelectionChip`, the live
"2 selected · Ctrl-C copy · Del remove" line in the same toolbar strip. A
reference list is read once and then in the way; a selection count changes with
every click, and a number you have to open a drawer to read is a number nobody
reads. The chip renders its wrapper even at zero so
`data-canvas-selection-count` is always readable, and shows nothing at all when
the canvas is idle.
