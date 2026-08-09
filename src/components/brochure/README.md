# `components/brochure` — the seasonal brochure

The second output of "one entry, many surfaces". A brochure is assembled from
sessions and schedule groups the org already entered, re-worded freely, and
published at a public URL.

**Read the header of `supabase/migrations/031_brochures.sql` before changing
anything here.** The candidacy → membership → publication model is what stops a
brochure rewriting itself when a season rolls over, and every component below is
shaped by it.

## The model, and where each state lives

| State | Stored? | Where |
|---|---|---|
| **Candidacy** | No — computed | `lib/brochure/candidates.ts`, shown in `CandidateRail` |
| **Membership** | Yes | `brochure_entries` rows, created only by `/api/brochures/pull` |
| **Publication** | Frozen | Entry copy is snapshotted at pull time and owned by the brochure |

The single most important consequence: **editing a session never changes a
brochure entry pulled from it.** `EntryEditDialog` says so out loud, because
"edit" everywhere else in this app writes through to the underlying thing.

## Files

| File | Role |
|---|---|
| `BrochuresManager.tsx` | The list, and the create dialog. Creating drops you straight into the editor. |
| `BrochureEditor.tsx` | The workspace: sections, entries, the removed tray, drag between sections. |
| `CandidateRail.tsx` | "Suggested" — candidacy made visible. |
| `EntryEditDialog.tsx` | An entry's own copy. Never the source's. |
| `BrochureSettingsDialog.tsx` | Cover, intro, season, accent. Owner/admin only. |
| `BrochureDocument.tsx` | The published document, on screen and on paper. |
| `PrintButton.tsx` | One client island so the document stays a server component. |

## Drag moves between sections; buttons order within one

`@dnd-kit/sortable` is not a dependency and the brief asks not to add packages
casually, so dragging uses `@dnd-kit/core` for the coarse action it is genuinely
good at — "this belongs in that section" — and ordering uses explicit up/down
controls.

That is also the better call for the mobile-first requirement: drag-to-sort on a
touchscreen inside a scrolling column is unreliable, and arrows are not. If true
drag-sorting is wanted later, `@dnd-kit/sortable` is the right way to get it —
hand-rolling sortable semantics (keyboard support, collision, transforms) is
exactly the thing that goes subtly wrong.

## Tombstones are visible on purpose

The "Removed" tray under the sections lists dismissed entries with a Restore
button, and the rail marks already-handled candidates as "removed" rather than
hiding them. An invisible editorial decision is one nobody can undo, and hiding
a dismissed candidate would make a tombstone invisible exactly where its effect
matters — someone would add everything again, watch it not come back, and
conclude the pull was broken.

## The public page is deliberately NOT cached

Every other public route here uses `"use cache"` with `cacheLife("hours")`.
`/org/[orgSlug]/brochure/[brochureSlug]` does not, and that is not an oversight.

Its query result depends on `status`, which staff flip from the editor. A first
attempt cached it and invalidated by tag on every write; the verification
harness caught that **unpublishing did not take effect** — the withdrawn
brochure went on being served. The reverse case is just as bad: a null cached
while a brochure was a draft would 404 it after publishing.

A publish gate is the last thing a cache should sit in front of. React's
`cache()` still dedupes within a single request, so `generateMetadata` and the
page share one query set.

## Printing

`BrochureDocument` is the same markup on screen and on paper — no print-only
route, for the same reason the event calendar has none: a second rendering of
the same content is free to drift.

Print rules live at the bottom of `globals.css`. They are separate from the
event calendar's block because the two want opposite things: the calendar is one
landscape page extracted out of a dashboard, a brochure is a multi-page portrait
document that *is* the page. The rules that matter are `break-after: avoid` on
section headings (a heading stranded at the foot of a page is the classic way a
printed document looks broken) and `break-inside: avoid` on entries.

Links print with their URL beside the label, since a hyperlink on paper is
otherwise a dead end. Hidden on screen, where the link works.

No server-side PDF library. Browser "Save as PDF" over these rules is the
deliverable, and a dependency that renders HTML to PDF server-side would have to
earn its weight against a document this shape — it doesn't.
