# Analytics

`/dashboard/analytics` is a **section of three sibling pages**, not one page.
They answer three different questions about the same building, from three
different tables, at three different confidences:

| Page | Question | Source | Gate |
|---|---|---|---|
| **Engagement** (`/analytics`) | Who looks at the schedule? | `analytics_events` | `analytics:view` — owner, manager |
| **Utilization** (`/analytics/utilization`) | What is the building programmed for? | `sessions`, expanded | `operations:view` — + coordinator |
| **Attendance** (`/analytics/attendance`) | Who actually showed up? | `facility_readings` (061) | `operations:view` |

The index keeps the bare `/dashboard/analytics` path, so nothing already linked
breaks and no redirect exists. `layout.tsx` explains why the gates differ and
why the tabs carry the query string.

The chart kit (`MetricCard`, `ViewsChart`, `ActivityHeatmap`, `BreakdownBars`,
`RankedList`, `DailyBars`) and `AnalyticsToolbar` are shared by all three, so
the section reads as one product. Marks use `--viz-cat-1`, never shadcn's
`--primary`.

Below: where each page's numbers come from, and the three things that are easy
to get wrong in all of them.

```
widget.js ─┐
           ├─► POST /api/analytics/track ─► analytics_events ─┬─► queries.ts ─────► Engagement
useScheduleAnalytics ─┤                                       │                          │
SessionModal ─────────┘                                       └─► analytics_daily_summary │  (nightly, unused here)
                                                                                          │
sessions + department_hours/holidays (058/059) ─► utilization.ts ─► summariseRange() ─────┼─► Utilization
                                                                                          │
/dashboard/counts ─► facility_readings (061) ─► attendance.ts ────────────────────────────┴─► Attendance
                                                                                          │
                                                                        /api/analytics/export
                                                                        (6 datasets, 2 gates)
```

| File | Job |
|---|---|
| `range.ts` | The period. Inclusive local calendar days, presets, clamping, the previous-period window. Client-safe. |
| `queries.ts` | One read of `analytics_events`, aggregated into everything **Engagement** renders. |
| `csv.ts` | All six export datasets, and the escaping that keeps them from executing. |
| `utilization.ts` | Expands the schedule week by week over a range, then `summariseRange()` in `schedule/weekOverview.ts`. |
| `attendance.ts` | The paged read of `facility_readings`, and the pure `summariseAttendance()` the harness calls directly. |

## The event types

Defined by the CHECK constraint in `041_widget_analytics_expansion.sql`, plus
`link_click` from `050_template_description_tags_links.sql`.

| Event | Fired by | Carries |
|---|---|---|
| `widget_view` | `public/embed/widget.js`, once per embed load | facility (if the embed names one), referrer |
| `facility_view` | `useScheduleAnalytics` on a public facility page | facility, template |
| `view_change` | `useScheduleAnalytics` on a template switch | template |
| `program_click` | `SessionModal` when a visitor opens a session | facility, schedule group |
| `link_click` | `SessionModal` when a visitor follows the registration link | facility, schedule group |
| `session_duration` | `useScheduleAnalytics` on unload, via `sendBeacon` | duration |
| `schedule_view` | nothing yet — reserved | — |

Staff are excluded at the source: `SessionModal` suppresses both click events
when it is rendered inside the dashboard preview.

## Three traps — and they apply on all three pages now

**1. PostgREST caps a response at `max_rows`, and says nothing.**
The previous summary asked for `.limit(20_000)` in one request. A default
Supabase project answers with 1,000 rows — measured, not assumed — so every
total on the page and in the overview ticker was the first thousand events,
with no error and no symptom. `fetchAnalyticsEvents` pages with `.range()`
until the window is exhausted or `MAX_ROWS` is reached, and reports
`truncated` so the page can say when it stopped early. Any new read of this
table must page the same way. `attendance.ts`'s
`fetchReadings` does; `GET /api/facilities/[id]/readings` deliberately does not
and caps itself at 200 instead, because it serves a recent log rather than a
dataset — and says so where a caller will see it.

**2. The window's far end is exclusive.**
A range is a pair of *days*, and the last day has to be included whole.
`rangeEndInstant()` returns local midnight on the day **after** `to`, used
with `.lt()`. The obvious `.lte(to-at-midnight)` silently drops everything
that happened during the final day, which is most of what anyone wants to
see.

**3. Days and hours are local, everywhere.**
Bucketing with `toISOString().slice(0,10)` puts a 7pm Pacific visit on
tomorrow's bar and moves the busiest-hour heatmap by the UTC offset. Since
`036` removed the timezone column there is no stored zone to convert into, and
every other calendar surface in the app reads the runtime's local clock — so
this does too. Use `toLocalDay()` and the local `Date` getters; never the ISO
string. The same rule applies to a verification harness building fixtures
(see `scripts/verify/README.md`).

## Visitor counts, and what they cannot be

`ip_hash` is `SHA-256(ip + today + ANALYTICS_IP_SALT)`. The date component
rotates daily, so a hash identifies a visitor **within one day and never
across two**. Therefore:

- "Unique visitors" is distinct hashes per day, summed over the period. Someone
  who visits on Monday and Friday counts twice.
- There is no returning-visitor metric, no funnel across days, and no session
  stitching. These are not missing features; the hash is built specifically to
  make them impossible.

The metric tile says this in its (i). Keep it there.

## The two numbers each new page must not invent

**Utilization: there are two kinds of hour, and a naive sum is neither.** Clock
hours are the UNION of occurrences (parallel sessions count once); space-hours
are the sum of duration × spaces held. Adding durations double-counts anything
parallel, so a busy Saturday can report more hours than the day has. Drop-in
figures are also what is **left** after exclusive claims are subtracted —
`utilization.ts` does that subtraction itself, because `expandSessions` does
not and the API route's residual pass is a separate step after it.

**Attendance: there is deliberately no total.** A head count is an observation
made by eye, not a turnstile, so summing them produces a number that looks like
"visits" and is nothing of the kind. The peak is the defensible figure; the
average is an average of *observations*, which moves when counting habits
change and not only when attendance does. Every tile says so behind its (i).

## Export

`GET /api/analytics/export?range|from&to&facility&dataset` — `summary`,
`daily`, `breakdowns`, `events`, `utilization` or `attendance`, over the same
inputs the page read, so a download always matches the screen. The first four
are behind `analytics:view`; the last two behind `operations:view`, matching
their pages.

Two properties the CSV must keep:

- **It cannot execute.** Referrer hostnames are attacker-supplied, and a cell
  beginning `=`, `+`, `-` or `@` is a formula when the file opens in Excel or
  Sheets. `escapeCell` prefixes an apostrophe *inside* the quoting. This is why
  the module does not use papaparse's `unparse`, which quotes correctly and
  does nothing about this.
- **It keeps the privacy promise.** No `ip_hash`, no raw `user_agent` — the
  export reports the device class derived from the agent and stops there. See
  the note at the top of `005_analytics_tables.sql`.

## Authorization

Two permissions, and the split is the point. `analytics:view` (owner + manager)
covers **Engagement** — org-wide visitor data a coordinator has no business
reading for departments outside their scope. `operations:view` (owner + manager
+ coordinator) covers **Utilization** and **Attendance**, because a coordinator
filling the schedule is exactly who needs to know how much of the week is
unprogrammed and when the building is busy.

Widening `analytics:view` instead would have handed coordinators the visitor
analytics too, which is why there are two. Both are asked by the pages, the
export route and the sidebar; `analytics:view` was declared in `roles.ts` from
the start and asked by nothing until the Engagement page was rebuilt.

## Verifying a change

```
node --experimental-strip-types scripts/verify/verify-ax.mjs --logic-only   # Engagement: ranges, CSV, classifiers
npm run dev && node --experimental-strip-types scripts/verify/verify-ax.mjs  # + the real read and export
node --experimental-strip-types scripts/verify/verify-bb.mjs --logic-only  # the section: summariseRange + summariseAttendance
npm run dev && node --experimental-strip-types scripts/verify/verify-bb.mjs  # + the gates, the pages and both new CSVs
```

`verify-ax`'s live half seeds 1,100 events on one day specifically to prove
trap 1 stays fixed, and an event at 23:30 on the final day to prove trap 2.
`verify-bb` does the same for `facility_readings`, and additionally asserts
that `summariseRange` over a single week equals `buildWeekOverview` for that
week — the generalisation must not have changed the arithmetic the week panel
still depends on.
