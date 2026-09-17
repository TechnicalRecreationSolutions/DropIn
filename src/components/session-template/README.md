# `components/session-template` — defining a recurring activity

A session template is the thing staff drag onto the grid. It carries a name and
a colour, a set of defaults that seed each placement, and — since migration
`050` — the description, tags and links that patrons see.

| File | Role |
| --- | --- |
| `SessionTemplateForm.tsx` | The whole create/edit form, as three numbered steps |
| `TagPicker.tsx` | Step 3 — picks from the facility's tag vocabulary, and adds to it |
| `LinksEditor.tsx` | Step 3 — up to three ordered `{label, url}` rows |
| `DeleteSessionTemplateButton.tsx` | Archive (soft-delete) from the templates list |

## Why three steps

It was one flat card of eight field groups. That was survivable at five and
stopped being so when `050` added three more: nothing was required except the
name and the length, but nothing said so, so the form read as eight decisions
instead of two.

The steps are grouped by the **question being answered**, not by which table the
column lives in:

1. **What it is** — name, colour.
2. **What gets pre-filled** — duration, spaces, and the occupancy/disclosure
   seeds from `047`. These belong together because they are the same *kind* of
   thing: every one is a default that a placed session then owns outright.
   Splitting duration away from the occupancy pair, as the old layout did, hid
   that they behave identically.
3. **What patrons see** — description, tags, links. All public, all optional.

Same numbered-step chrome as the widget studio (`ui/step-card.tsx`), for the
reason recorded in `components/widget/README.md`: a pile of visually identical
cards has no first thing to do and no last.

## What makes it faster, specifically

Each of these is asserted as an interaction in `scripts/verify/verify-ac.mjs`,
not just as a control that exists:

- **Duration chips.** A pool runs 30/45/60/90/120 minute blocks and almost
  nothing else. The number field stays for the genuine exception.
- **Select all / Clear all on spaces.** Lap swim occupies every lane; picking
  eight of them one at a time was the slowest interaction on the form.
- **A sticky save bar**, so Save is reachable without scrolling past three steps.
- **Live summaries in each step header** (`1 hr 30 min · all spaces · Drop-in`),
  so the parts you are not editing can be read without scrolling into them.
- **A live card preview** in step 3, drawn the way `WeeklyScheduleGrid` draws a
  card. Colour is chosen in step 1 and tags in step 3, and neither reads as a
  visual decision until they are seen together on the thing they produce.

## Two traps

**The save bar and the mobile bottom nav are both `fixed bottom-0`.**
`DashboardBottomNav` is `z-50` below `lg`, so at `bottom-0` the save button is
not merely overlapped — it is entirely invisible on a phone. The bar clears the
nav with `bottom-[65px] lg:bottom-0` rather than outranking it, because burying
the app's primary navigation is the worse trade. That 65px is measured, and
`verify-ac` §2 asserts the two never overlap, so a change to the nav's height
fails loudly instead of silently hiding Save again.

**`TagPicker` reports its vocabulary upward** (`onVocabularyChange`) so the form
can draw the preview — `selectedIds` alone is enough to save but not enough to
show anyone what they are building. Two rules come with that:

- The parent's callback must be **stable** (`useCallback`), because the load
  effect depends on it. An inline arrow refetches the vocabulary every render.
- Notify from an event handler, **never from inside a `setTags(prev => …)`
  updater**. React may run an updater during render, and a parent `setState`
  landing mid-render warns "Cannot update a component while rendering a
  different component". It broke nothing visible when it happened here — the
  tag saved, the preview drew — so only the console said so, which is why
  `verify-ac` §9 now watches for it.
