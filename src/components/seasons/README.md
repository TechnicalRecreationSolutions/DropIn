# Seasons (`/dashboard/seasons`)

A **season** is the org's named planning period — "Fall 2026", Sep 8 – Dec 20. It is the
period an org schedules, publishes, and prints in, and it exists because Dropin could
previously only describe a *week*.

Seasons are the foundation the seasonal event calendar, the brochure, and the planning
tooling are all built on. Everything here is deliberately small: the value is in what other
features can now assume, not in this page.

## The rules worth knowing

**Org-level, not per facility.** One "Fall 2026" spans every building. A facility that wants
its own view of a season filters it; it does not get its own season row. See the header of
`supabase/migrations/027_seasons.sql` for this and the decisions around it — that file is the
reference, not this one.

**They may overlap.** Summer camps genuinely straddle a spring session. Because of that,
"which season is current" is not derivable from today's date alone, and the rule lives in
exactly one place: [`src/lib/seasons/current.ts`](../../lib/seasons/current.ts). Never
re-derive it inline.

**Three states, not published/unpublished.** `planning` is staff-only, `active` is public,
`archived` is over but still publicly resolvable — so a link printed in last year's brochure
keeps working. That's why this table uses `status` where the rest of the schema uses
`is_published`.

**Dates are strings, never Dates.** `starts_on`/`ends_on` are DATE columns — calendar days
with no zone. Parsing them into a `Date` attaches the browser's offset, which is how "Fall
starts Sep 8" becomes Sep 7 for anyone west of the server. ISO date strings compare
lexicographically, so comparisons stay correct and zone-free. `seasonStartAsDate()` is the
single sanctioned crossing point.

## Files

| File | Role |
|---|---|
| `SeasonsManager.tsx` | The list and its actions. Seeded from the server, then maintained locally from each mutation's response — a short list only this page writes to. |
| `SeasonFormDialog.tsx` | Create and edit. One dialog for both; the fields are identical. |
| `DeleteSeasonDialog.tsx` | Confirms deletion, and says plainly that sessions are unassigned rather than deleted. |

## Where a season actually does something

The command centre's `SeasonPicker` (`components/schedule-command/`) is where a season earns
its keep. Selecting one sets the defaults for everything placed from there: new sessions are
assigned to it and dated to its range.

It deliberately **does not filter the schedule**. Every session that predates seasons has
`season_id NULL`, so a hard filter would blank the grid for every existing org the moment
they created their first season — and an empty schedule reads as data loss, not as a filter.
The season is a lens on new work, not a gate on old work. The same reasoning is why weeks
stay freely navigable and the picker merely *offers* a jump when the week on screen falls
outside the season.

## Permissions

Creating and re-dating a season is structural planning, so it's owner/admin — the same line
migration `024` drew for facilities, departments and schedule groups. Members see the list
(they schedule into these periods) and get no write controls. Enforced in RLS *and* at the
route layer, because the publishable key is in the browser bundle and route checks alone are
skippable.

## Duplicate is a prefill, not a copy

A season currently owns nothing but a name, a range, and a status, so copying one would just
produce a row the user has to open and edit anyway. "Duplicate" therefore opens the create
form seeded a year on. Once seasons carry task checklists, this becomes a real copy
operation — that's the point to revisit it.
