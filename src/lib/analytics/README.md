# Analytics

What `/dashboard/analytics` shows, where the numbers come from, and the three
things that are easy to get wrong here.

```
widget.js ─┐
           ├─► POST /api/analytics/track ─► analytics_events ─┬─► lib/analytics/queries.ts ─┬─► /dashboard/analytics
useScheduleAnalytics ─┤                                       │                              └─► /api/analytics/export
SessionModal ─────────┘                                       └─► analytics_daily_summary (nightly, unused here)
```

| File | Job |
|---|---|
| `range.ts` | The period. Inclusive local calendar days, presets, clamping, the previous-period window. Client-safe. |
| `queries.ts` | One read of `analytics_events`, aggregated into everything the page renders. |
| `csv.ts` | The four export datasets, and the escaping that keeps them from executing. |

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

## Three traps

**1. PostgREST caps a response at `max_rows`, and says nothing.**
The previous summary asked for `.limit(20_000)` in one request. A default
Supabase project answers with 1,000 rows — measured, not assumed — so every
total on the page and in the overview ticker was the first thousand events,
with no error and no symptom. `fetchAnalyticsEvents` pages with `.range()`
until the window is exhausted or `MAX_ROWS` is reached, and reports
`truncated` so the page can say when it stopped early. Any new read of this
table must page the same way.

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

## Export

`GET /api/analytics/export?range|from&to&facility&dataset` — `summary`,
`daily`, `breakdowns` or `events`, over the same inputs the page read, so a
download always matches the screen.

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

`analytics:view` (owner + manager), asked by the page, the export route and the
overview's ticker tile. It was declared in `roles.ts` from the start and asked
by nothing until the page was rebuilt.

## Verifying a change

```
node --experimental-strip-types scripts/verify/verify-ax.mjs --logic-only   # ranges, CSV, classifiers
npm run dev && node --experimental-strip-types scripts/verify/verify-ax.mjs  # + the real read and export
```

The live half seeds 1,100 events on one day specifically to prove trap 1 stays
fixed, and an event at 23:30 on the final day to prove trap 2.
