# Settings

`/dashboard/settings` is a **section**, not a page. Nine routes, one rail, one
list that decides what exists.

## What this replaced

Before 2026-09-22 there was a page called **Organization** and three unrelated
sidebar rows — Staff, Billing, Data sources — sitting under a heading that also
said "Settings". Nothing tied them together:

| Before | After |
| --- | --- |
| `/dashboard/settings` — a 300-line form with a public profile, a postal address and a staff-permission switch stacked in it | `…/settings` (General), `…/contact`, `…/permissions` |
| `/dashboard/staff` | `…/settings/staff` |
| `/dashboard/billing` | `…/settings/billing` |
| `/dashboard/data-sources` | `…/settings/data-sources` |
| *nowhere* — no way to change your own password | `…/settings/account` |
| *nowhere* — no summary of what patrons can see | `…/settings/public` |
| Transfer ownership, appended below a postal code | `…/settings/danger` |
| *nowhere* — `org:delete` had no policy, route or button | `…/settings/danger` |

The old three paths are 308-redirected in `next.config.ts`. They are in browser
histories, in sent invitation emails, and — until this shipped — in Stripe's
stored checkout return URLs, so they are not dead paths.

## The one list

`nav.ts` exports `SETTINGS_NAV`. Three things read it and must not disagree:

1. the rail in `dashboard/settings/layout.tsx`,
2. the expandable Settings group in `components/layout/SidebarMenu.tsx`,
3. `scripts/verify/verify-bc.mjs`, which walks every href as four roles.

When the sidebar kept its own copy, adding a settings page meant remembering to
add it twice, and the failure mode was a page that existed but could not be
found — indistinguishable, from the outside, from a page that was never built.

**Adding a page:** add an entry to `SETTINGS_NAV`, create the route, give it a
permission check of its own, and add an icon to `SETTINGS_ICONS` in
`SidebarMenu.tsx` (a missing icon falls back to the gear rather than crashing).
The icons live there and not here because this module is imported by server
components, and a lucide import per row would drag the icon set into their
bundles for nothing.

## Rules this section follows

**Items are removed, never greyed out.** The rule `SidebarMenu` already
followed. A disabled "Billing" row invites an aux staffer to wonder what is
behind it, and every page added later would have to remember to disable itself.

**Every page guards itself.** The layout guards nothing: it renders during the
prerendered shell pass with no org context at all, so a check there would be a
check that is sometimes absent. Each page asks, and each API route asks again
independently. The rail is navigation, not authorization.

**A refused page redirects to `…/settings/account`, not to a 403.** That page
has no permission on it, so it is always a real destination — which is also why
the section as a whole is offered to every role including aux.

**Read-only viewers see disabled fields, not a missing page.** Knowing what your
organization has published is reasonable, and a disabled field says "you can't
change this" more clearly than a 404. The API enforces the same rule
independently, which is what makes showing it safe.

## Two things worth not relitigating

**`Your account` has no permission, deliberately.** It is where somebody changes
their own password, and a person who cannot change their password is a person
whose leaked password stays valid. That was true of this product until this
section existed. "Leave this organization" moved here from the Staff page for
the same reason — Staff is gated on `staff:view`, which excludes aux, so a
lifeguard had no way to leave at all.

**The role matrix is rendered, not written.** `RoleMatrix.tsx` reads
`rolesWith(permission)` out of `lib/auth/roles.ts`. A hand-typed "what each role
can do" table is a second source of truth that drifts the first time a
permission moves between groups — silently, because nothing fails; the table
just starts lying to the manager deciding who to invite.

## Deleting an organization

`delete_organization()` (migration 062) is the only path, and there is **no
DELETE policy on `organizations`** on purpose: RLS can say "you own this row"
but not "and you typed its name" or "and you are not still being billed". The
function requires all three, and `DELETE /api/organizations` checks the name
again first only so the message can name it.

Everything with an `org_id` cascades (all 40 tables declare
`ON DELETE CASCADE`). Two things do not, and the route handles the first:

- **Storage** — `org-media/{orgId}/…` is swept by the route with the
  service-role client, *after* the row is gone. Storage is not transactional
  with Postgres, so one lands first either way: an orphaned image is a wasted
  byte, whereas images deleted while the row survives is a live public site with
  every logo 404ing.
- **Auth users** — theirs, not the organization's. They may belong to other
  orgs; they keep the account and land on onboarding.

## Files

| Path | What it is |
| --- | --- |
| `lib/settings/nav.ts` | The list. Start here. |
| `app/(dashboard)/dashboard/settings/layout.tsx` | The shell and the rail |
| `components/settings/SettingsNav.tsx` | Rail on desktop, tab strip on phones |
| `components/settings/SettingsSection.tsx` | Heading, card, fact-list, read-only notice |
| `components/settings/RoleMatrix.tsx` | The permission model, rendered |
| `components/org/useOrgPatch.ts` | The save half of the three org forms |
| `components/account/AccountPanel.tsx` | Password, email, theme, sessions |
| `components/org/DeleteOrganization.tsx` | The inventory and the typed name |
| `app/api/account/route.ts` | Password / email / sign-out-others / snapshot sync |
| `app/api/organizations/route.ts` | `PATCH` the profile, `DELETE` the org |
| `supabase/migrations/062_organization_deletion.sql` | The only path to a delete |
| `scripts/verify/verify-bc.mjs` | The harness |
