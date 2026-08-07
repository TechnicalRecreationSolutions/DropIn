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
  writing silently.
- **`canCreate` is false when the scope spans schedules.** A new session needs exactly one
  `schedule_group_id`, so the command centre's "All schedules" mode stays view + duplicate +
  delete only.
- **Duplicating uses the session's own `scheduleGroupId`**, not the currently-selected one —
  otherwise duplicating from an all-schedules view would silently reparent the copy.
- **Templates carry `default_space_ids`** via the `session_template_spaces` join, so the
  create dialog can pre-select the spaces a template usually occupies.
- The provider's `value` is memoized in `ScheduleCommandCentre`; passing a fresh object each
  render would re-render every session block on every keystroke in a dialog.
