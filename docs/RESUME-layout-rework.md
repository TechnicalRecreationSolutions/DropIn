# Dashboard chrome rework — what's left

## Where this comes from

The dashboard header/sidebar/overview were reworked from a mockup (fixed
header with icon row + theme toggle + avatar; sidebar with Facility/
Department/Schedule dropdown filters + a flat Menu + a profile footer; a
stat-card row + chart grid on the Overview page). The user was explicit that
this pass is about layout structure, not new backend functionality — pieces
of the mockup that don't correspond to anything Dropin has built yet were
left as honest placeholders (a "Coming soon" tile, a disabled icon with a
tooltip) rather than faked. This doc is the list of what would need to be
built to make each of those real, in no particular priority order — nothing
here is scheduled.

## App-wide dark mode

`globals.css` already defines full `.dark` tokens, and the new header has a
working toggle (`DashboardTopbar.tsx`, `useThemeToggle`) that flips the class
and persists the choice. But at the time of the rework, 28 files under
`src/app/(dashboard)` hardcode Tailwind `gray-*`/`white` classes instead of
the semantic tokens (`bg-card`, `text-foreground`, `border-border`, etc.)
already defined in `globals.css` — only 2 files used the tokens. The toggle
therefore only correctly re-themes the new chrome and the new Overview
stat/viz cards; every other dashboard page will look unchanged (light) when
switched to dark. Making dark mode real app-wide means retrofitting those 28
files to semantic tokens — a mechanical but sizeable pass, best done
file-by-file rather than all at once given how much of the app that touches.

## Notifications system

The header's Bell icon is a disabled placeholder. There's no notifications
concept in the schema at all — no table, no triggering events, no delivery
mechanism (in-app, email, or otherwise). Building this means deciding what
should notify someone first (a schedule conflict? a publish? a billing
event?) before any UI work.

## Real charts for the Reporting grid

All four tiles in the Overview's "Reporting" section
(`src/components/dashboard/VizPlaceholder.tsx` usages in
`src/app/(dashboard)/dashboard/page.tsx`) are placeholders. No charting
library is installed anywhere in the app. Building these for real needs:
- **A charting library decision** — nothing is installed today.
- **Schedule Completion Rate** — a published-vs-draft-over-time query;
  "completion" isn't a concept that exists yet, needs defining.
- **Department Performance** — same: "performance" has no defined meaning
  for this domain yet.
- **Facility Usage** — a per-facility breakdown of `analytics_events`
  (already real data, just not aggregated this way).
- **Widget Traffic Trends** — a time-bucketed query over `analytics_events`,
  pairing with the new "Widget views" stat card, which currently only shows
  a single 30-day count (`src/app/(dashboard)/dashboard/page.tsx`).

## A real Sessions log/list page

`/dashboard/sessions/page.tsx` is currently a placeholder — sessions are
managed per-schedule inside the command centre
(`src/components/schedule-command/`), and there's no cross-schedule,
org-wide session list. If that's wanted, it's a new page plus a new query
shape (sessions joined across every schedule group in the org), not just a
new route.
