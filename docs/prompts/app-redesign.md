# Prompts: bring the dashboard onto the new design

Five sessions, run in order. For each one, copy everything under its heading
into a **fresh Claude Code session run from `C:\ForRec\dropin`**. Each session
works on its own branch and ends with a commit; review and merge it before
starting the next.

Every session reads `docs/DESIGN.md` first. That file is the rulebook; these
prompts only say what to do in which order.

Before session 1: commit or merge the landing page work (`feat/marketing-positioning`)
so `main` has `src/components/marketing/landing/` and `docs/DESIGN.md`.

---

## Session 1: Foundations (tokens and shared components)

Branch: `design/foundations`

Read `docs/DESIGN.md` in full, then `AGENTS.md` (Next.js here has breaking
changes; read the relevant guide in `node_modules/next/dist/docs/` before
using a Next API).

Goal: make the shared layer match DESIGN.md so most of the app changes in one
step, without touching individual pages yet.

1. `src/app/globals.css`: set every token in DESIGN.md §3 in `:root` and `.dark`,
   and add the new ones (`brand`, `brand-subtle`, `brand-strong`,
   `destructive-subtle`, `warning`, `warning-subtle`, `success`,
   `success-subtle`) to `@theme inline` so Tailwind generates `bg-brand` etc.
   Set `--radius` so cards come out at 16 px. Leave `--viz-*`, `.org-theme`,
   the print rules and the chart tokens alone.
2. **Before** making `--accent` grey, find every place `bg-accent`,
   `text-accent*` or `bg-accent/…` is used as a blue fill (about 20) and move
   each to the `brand` tokens, as DESIGN.md §9 says. Then change `--accent`.
3. Restyle the primitives in `src/components/ui/` to DESIGN.md §6: `button`
   (pill, variants and sizes as listed), `input`, `select`, `card`, `dialog`,
   `sheet`, `tabs`, `badge`, `dropdown-menu`, `info-tip`, `step-card`. Keep
   their props and exports unchanged so no caller breaks.
4. Point the `--sidebar-*` variables at the plain tokens so the sidebar is no
   longer navy (the full sidebar rework is session 4). Delete the
   `.sidebar-scroll` navy scrollbar rule or re-point it.
5. Check: `npx tsc --noEmit`, `npm run lint`, then run the app, log in, and
   screenshot the dashboard home, the schedule page, a settings page and a
   dialog, in light and dark, at 1440 px and 390 px. List anything that now
   looks broken; don't fix page-level styling in this session.

Commit: `design(foundations): tokens and ui primitives per docs/DESIGN.md`

---

## Session 2: Replace hard-coded colours, part A (frame, settings, people)

Branch: `design/sweep-a` (from main after session 1 is merged)

Read `docs/DESIGN.md`, especially §9 (the replacement table) and §10.

Scope, and nothing else: `src/components/layout/`, `settings/`, `org/`,
`staff/`, `account/`, `auth/`, `activity/`, `dashboard/`, `data-entry/`,
`import/`, and the pages under `src/app/(dashboard)/dashboard/settings`,
`activity`, `counts`, `(auth)`.

1. List every raw palette class and hex literal in scope
   (`rg -n "(bg|text|border|ring|from|to)-(blue|gray|slate|zinc|neutral|red|green|amber|yellow|orange|emerald|sky|indigo)-[0-9]{2,3}|#[0-9a-fA-F]{6}"`).
2. Replace them using DESIGN.md §9. Hand-built blue buttons become `<Button>`
   (use `asChild` around a `Link`). Remove the `dark:` twins as you go.
3. Keep one `default` (ink) button per view; demote the rest to `outline` or
   `ghost`.
4. Don't change layout, copy or behaviour in this session; colours and
   buttons only.
5. Check as in DESIGN.md §10 for every page touched.

Commit: `design(sweep-a): tokens in layout, settings, staff, auth, activity`

---

## Session 3: Replace hard-coded colours, part B (schedule and spaces)

Branch: `design/sweep-b`

Same instructions as session 2, for: `src/components/schedule/`,
`schedule/editing/`, `schedule-command/`, `schedule-editor/`,
`session-template/`, `schedule-group/`, `schedule-list/`, `department/`,
`space/`, `facility/`, `facilities/`, `conflicts/`, `status/`, `conditions/`,
`widget/`, `media/`, `facility-maps/`, and their dashboard pages.

**Extra care here:** many of these components also render the *public*
widget and facility page inside `.org-theme`, where colours come from the
centre's brand (`--org-*`). Before changing a colour, check whether the
component is rendered under `.org-theme` (search for `OrgThemeProvider` and
`org-theme`). Public-facing colours stay on the `--org-*` variables; only
staff-only chrome moves to Dropin's tokens. Session template colours,
`sessionCardColor.ts`, the floorplan renderer's water and court colours, and
the deck sheet's print colours stay as they are.

Commit: `design(sweep-b): tokens in schedule, spaces and facility screens`

---

## Session 4: The app frame

Branch: `design/frame`

Read `docs/DESIGN.md` §7. Rebuild the sidebar, top bar and page header to it:
`SidebarNav`, `SidebarMenu`, `SidebarProfile`, `SidebarFilters`, `TreeNav`,
`TreeNavNode`, `DashboardTopbar`, `DashboardBottomNav`, `Breadcrumb`,
`DashboardChromeSections`, `DashboardChromeSkeletons`, and the mobile tree
sheet. Light sidebar, wordmark only, the active item with a `muted` fill and
a 2 px `brand` marker. Then give every dashboard page the same title row
(28 px title, optional one-line description, main action on the right).

Keep every route, link and permission check exactly as it is. Check desktop
and mobile, light and dark, and keyboard navigation through the sidebar.

Commit: `design(frame): light sidebar, top bar and page headers`

---

## Session 5: Screen-by-screen polish

Branch: `design/screens`

Read `docs/DESIGN.md` §6 and §8. Go screen by screen, in this order, and
remove what §8 lists (tinted icon squares, uppercase eyebrows, coloured left
borders, stacked blue buttons, emoji, gradients), then align spacing and type
to §4–§5:

1. Dashboard home (`/dashboard`) and analytics
2. Schedule command centre (`/dashboard/schedule` and its tabs)
3. Sessions and session templates
4. Facilities, departments, spaces and the map editor
5. Widget studio
6. Settings (every tab) and billing
7. Sign in, sign up, onboarding, invitations
8. Empty states and loading skeletons everywhere

After each screen: screenshot before and after (1440 px and 390 px, light and
dark), and note anything that needed a judgement call in the commit message.
Stop and ask before changing behaviour or copy.

Commit per screen group: `design(screens): <screen>`
