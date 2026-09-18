# Staff accounts, roles and permissions

**Status:** 2026-09-18 — **done and verified. Migrations applied.**

`055` and `056` are live on the hosted database (confirmed by probe:
`membership_scopes` and `invitation_scopes` exist, all four RPCs answer, and
both existing owners got their email backfill). `tsc`, `eslint src` and
`next build` pass.

- `node scripts/verify/verify-al.mjs` → **41/41**, every deny asserted against
  PostgREST directly rather than through an API route.
- Five key assertions were **falsified** — the bug each one guards was injected
  and every one flipped to FAIL, so the harness is sensitive rather than
  merely green.
- The new pages were rendered in a real browser as owner, manager, coordinator
  and aux: **32 further checks, all passing**.

> **Still owed:** `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are not in
> `.env.local`, so invitations are created but **not emailed** — the dialog
> falls back to "copy this link", which works. See §6.4 for the larger mail
> problem, which this does not solve.

**Goal:** more than one person can sign in to an organization, with the
authority each of them actually needs and no more.

Today an organization has exactly one account — the address that signed up. The
tables to fix that have existed since migration `001` and have never been used.
This document is the design for using them.

---

## 1. What already exists (and what is inert)

Read this before writing code. Most of the mental model is already in the
repository, which is why this is smaller than it looks.

| Piece | State |
|---|---|
| `org_memberships` (`owner` / `admin` / `member`) | **Table live, used for one thing**: `getOrgContext()` reads it to find your org. |
| `staff_invitations` (with a DB-generated 32-byte token) | **Table live, referenced in zero source files.** Never written, never read. |
| `public.org_can_manage(org_id)` — migration `024` | **Live and load-bearing.** Gates `FOR ALL` on 9 structural tables. |
| `public.user_org_ids()`, `public.org_role()`, `public.is_superadmin()` | Live, used throughout RLS. |
| `["owner","admin"].includes(membership.role)` | Inline in **~30 API routes**. The real app-layer check. |
| `src/lib/auth/roles.ts` (`hasRole`/`isAdmin`/`isOwner`) | **Dead code — zero call sites.** |
| Migration `023` | Deleted the invitation read policy *and left the accept-flow design in a comment*. Follow it. |

**Live data, measured 2026-09-18:** 2 organizations, 2 memberships, **both
`owner`**, 0 invitations, 4 facilities, 5 departments, 5 schedule groups, 23
spaces. There is not a single `admin` or `member` row in the database.

That last fact is the reason this plan is cheap: **the role restructure has no
data to migrate.** It will never be this cheap again.

---

## 2. The four roles

The names below are the database values. `admin` and `member` are retired.

### Owner

The account that signed up. Exactly one per org, created by
`/api/auth/onboard-org`. Can do everything a Manager can, plus the four things
that can end an organization:

- billing, subscription and the Stripe portal
- deleting the organization
- transferring ownership
- being immune to removal or demotion by anyone else

Ownership moves only by explicit transfer, which demotes the old owner to
Manager in the same transaction. There is never zero owners and never two.

### Manager

Org-wide authority over everything operational. Creates facilities,
departments, spaces, floorplans and the widget; edits any schedule in any
department; invites and removes staff including other Managers.

A Manager **cannot** touch billing, delete the org, or remove the Owner.

> **Managers can remove other Managers.** This was a deliberate choice against
> the safer-sounding alternative. If Managers could *invite* peers but only the
> Owner could *remove* them, the role would ratchet upward — power accumulates
> and only one person can prune it. Peers who can add each other must be able to
> remove each other. The Owner is the only protected row, which is the whole
> point of keeping Owner separate.
>
> Nobody, at any level, can change their own role or remove their own
> membership while holding it — see §5.6.

### Coordinator

Scoped to **one or more departments**, and total authority inside them:
schedule groups, sessions, session templates, spaces belonging to those
departments, week reviews, conflict dismissals, publishing.

Outside those departments they can read and change nothing.

A Coordinator cannot create facilities or departments, cannot edit the
floorplan, cannot touch the widget, cannot see billing or analytics.

> **Why departments and not facilities.** `departments` belong to a *facility*,
> not to an org — "Aquatics" at Commonwealth Pool and "Aquatics" at Panorama
> are two different rows. A municipal Aquatics Coordinator running three pools
> therefore holds three department scopes. The scope is a **list**, never a
> single value, and the UI must present it that way from day one.

### Aux staff

Lifeguards, skate instructors, gym attendants, receptionists. Scoped to **one
or more facilities**, and **read-only** — the internal staff schedule for their
building, and the public schedule.

They write nothing, anywhere, ever. No dashboard beyond the schedule.

> **Why facility and not department.** A receptionist answers questions about
> the whole building; a lifeguard who wanders past the rink board is not a
> security event. Facility scope also sidesteps the NULL-department problem in
> §7 — assigning a building is one click, assigning every department is a
> checklist someone will get wrong.

---

## 3. The permission matrix

`👁` = read only. Blank = no access, and the navigation does not offer it.

| Capability | Owner | Manager | Coordinator | Aux |
|---|:--:|:--:|:--:|:--:|
| **Billing, subscription, Stripe portal** | ✅ | | | |
| **Delete the organization** | ✅ | | | |
| **Transfer ownership** | ✅ | | | |
| **Remove / demote the Owner** | ✅ | | | |
| Remove / demote a Manager | ✅ | ✅ | | |
| Org settings (name, logo, contact) | ✅ | ✅ | | |
| Facilities: create, edit, delete | ✅ | ✅ | | |
| Directory listing toggle (`/find`) | ✅ | ✅ | | |
| Departments: create, delete | ✅ | ✅ | | |
| Departments: rename / describe | ✅ | ✅ | ✅ own | |
| Spaces: create, edit, delete, reorder | ✅ | ✅ | ✅ own dept | |
| Floorplan, hotspots, map context | ✅ | ✅ | 👁 | 👁 |
| Widget studio + branding | ✅ | ✅ | 👁 | |
| Schedule groups: CRUD + publish | ✅ | ✅ | ✅ own dept | |
| Session templates | ✅ | ✅ | ✅ own dept | |
| Sessions: create, edit, drag, delete | ✅ | ✅ | ✅ own dept | |
| `session_internal` (rental holder, setup notes) | ✅ | ✅ | ✅ own dept | 👁 own facility |
| Week review / approve a week | ✅ | ✅ | ✅ own dept | |
| Conflict detection + dismissals | ✅ | ✅ | ✅ own dept | |
| Activity log — view | ✅ | ✅ | 👁 own dept | |
| Activity log — **revert** | ✅ | ✅ | | |
| Analytics | ✅ | ✅ | | |
| Import / data sources | ✅ | ✅ | | |
| Tags | ✅ | ✅ | ✅ create | |
| **Internal schedule (staff view)** | ✅ all | ✅ all | 👁 own facilities | 👁 own facilities |
| Public schedule, print, widget preview | ✅ | ✅ | ✅ | ✅ |
| View the staff list | ✅ | ✅ | 👁 own scope | |
| Invite a Manager | ✅ | ✅ | | |
| Invite a Coordinator | ✅ | ✅ | | |
| Invite Aux staff | ✅ | ✅ | ✅ own facilities | |

**A Coordinator's read scope is derived, not configured.** It is the set of
facilities containing their departments. Nobody has to keep two lists in sync.

---

## 4. The rule that everything else depends on

> ### An empty scope grants nothing. It never grants everything.
>
> A Coordinator with zero departments can edit nothing.
> An Aux staffer with zero facilities can see nothing.

"Empty means unrestricted" is the classic way authorization systems fail open,
and it fails open *silently* — nobody files a bug about seeing too much. Every
helper function in §5 returns `FALSE` on an empty scope. The invite UI refuses
to send a Coordinator or Aux invitation with no scope ticked, so the
fail-closed state should be unreachable — but it is the behaviour, not the form
validation, that is the guarantee.

---

## 5. Schema and RLS — migration `055`

### 5.1 Roles

```sql
ALTER TABLE org_memberships DROP CONSTRAINT org_memberships_role_check;
UPDATE org_memberships SET role = 'manager'     WHERE role = 'admin';
UPDATE org_memberships SET role = 'coordinator' WHERE role = 'member';
ALTER TABLE org_memberships ADD CONSTRAINT org_memberships_role_check
  CHECK (role IN ('owner','manager','coordinator','aux'));
```

Both `UPDATE`s affect zero rows today. They are written anyway so the migration
is correct against any database, not just this one.

`staff_invitations.role` gets the same treatment, minus `owner` — an
invitation can never mint an owner.

### 5.2 Identity on the membership row

`auth.users` is not readable through RLS, so a staff list cannot join to it.
Migration `038` already solved this for the activity log by **snapshotting**
`auth.users.email` onto the row. Same approach:

```sql
ALTER TABLE org_memberships
  ADD COLUMN email        TEXT,
  ADD COLUMN display_name TEXT;
```

Written once at accept time. A snapshot, not a live join — it stays readable
after the auth user is deleted, which is what the staff list needs.

### 5.3 Scopes — one table, exclusive arc

```sql
CREATE TABLE membership_scopes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES org_memberships(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  facility_id   UUID REFERENCES facilities(id)  ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(department_id, facility_id) = 1),
  UNIQUE (membership_id, department_id),
  UNIQUE (membership_id, facility_id)
);
```

One table rather than two (`membership_departments` + `membership_facilities`)
because the staff UI reads "this person's scope" as one query, and a future
grain is a column rather than a table. One table rather than a polymorphic
`(scope_type, scope_id)` because these are **real foreign keys** — deleting a
department cleans up after itself, and an orphaned scope row is impossible.

The two `UNIQUE` constraints coexist because Postgres treats NULLs as distinct
by default (`NULLS DISTINCT`), so the department constraint does not collide
with multiple facility rows. Do not add `NULLS NOT DISTINCT` to either.

> **Cascade trap.** `ON DELETE CASCADE` on `department_id` means deleting a
> department silently strips it from every Coordinator scoped to it — and if it
> was their only one, they drop to zero access. That is the correct fail-closed
> outcome, and it is *invisible*. The department delete confirmation must name
> the coordinators who will be affected, and the staff list must flag any
> membership with zero scopes.

### 5.4 Helper functions

`org_can_manage()` is **redefined**, not replaced:

```sql
CREATE OR REPLACE FUNCTION public.org_can_manage(p_org_id UUID) ...
  AND role IN ('owner','manager')   -- was ('owner','admin')
```

> One `CREATE OR REPLACE` silently changes the effective policy on **nine
> tables** (facilities, departments, schedule_groups, spaces, facility_maps,
> space_hotspots, map_context_elements, session_templates, widget_configs).
> That is exactly the leverage migration `024` built, and exactly why it needs
> the harness in §9 pointed at all nine.

New functions, all `STABLE SECURITY DEFINER SET search_path = public`:

| Function | Returns |
|---|---|
| `user_scope_department_ids()` | array of department ids, like `user_org_ids()` |
| `user_scope_facility_ids()` | array; for a Coordinator this is **derived** from their departments' facilities, unioned with any explicit facility scopes |
| `can_write_department(dept_id)` | owner/manager of that org, **or** coordinator holding that department |
| `can_write_schedule_group(sg_id)` | resolves the group's `department_id`, then `can_write_department`. **A group with `department_id IS NULL` is owner/manager only** |
| `can_read_facility(fac_id)` | owner/manager, or the facility is in `user_scope_facility_ids()` |
| `org_role_is(p_org_id, roles[])` | generic role test, replaces ad-hoc `org_role() IN (...)` |

### 5.5 The hole this closes

Migration `024` deliberately left `sessions`, `session_exceptions` and
`session_spaces` as `FOR ALL USING (org_id = ANY(user_org_ids()))`, because at
the time "any member may edit the schedule" was the intended model.

**Under the new model that is a privilege escalation.** An Aux staffer is a
member. The publishable key is in the browser bundle. Without this change, a
lifeguard could `DELETE` every session in the organization through PostgREST
without ever loading the dashboard.

So these move to `can_write_schedule_group(schedule_group_id)`:

- `sessions`
- `session_exceptions` (via its session)
- `session_spaces` (via its session)
- `session_internal` (via its session) — **and its SELECT narrows to
  `can_read_facility()`**, because `holder_name` is a rental customer's name and
  is the only genuinely sensitive field in the schema
- `schedule_week_reviews`
- `session_conflict_dismissals`

Reads of plain `sessions` stay at `org_id = ANY(user_org_ids())` on purpose:
that is the hot path for every schedule render, and the data is internal
scheduling for an org the reader works at. The facility narrowing for Aux is
applied in `/api/sessions/expand`, which already resolves memberships per
request. **`session_internal` is the exception and is enforced in RLS**, because
that one is PII rather than noise.

### 5.6 Membership policies — three existing bugs

Migration `002`'s membership policies were written for a flow that never
shipped, and have never been exercised. All three need fixing here:

1. **There is no `UPDATE` policy at all.** Changing someone's role is currently
   impossible except by delete-and-reinsert. Add one, restricted to
   owner/manager, and forbidden from targeting an `owner` row.
2. **`memberships_admin_delete` lets an admin delete the owner.** Under the new
   names, a Manager could remove the Owner and take the org. Add
   `AND role <> 'owner'`.
3. **Nothing prevents self-modification.** A Manager could promote themselves,
   or a Coordinator widen their own scope, if a policy ever let them.
   `AND user_id <> auth.uid()` on both UPDATE and DELETE, with "leave this
   organization" handled by its own explicit route.

`membership_scopes` gets its own policies: read within your org, write only
owner/manager — **never the scoped user themselves**, or scoping means nothing.

---

## 6. Invitations

The token exists and is generated in the database
(`encode(gen_random_bytes(32),'hex')`), never in application code. Keep it that
way.

### 6.1 Lookup — follow migration `023`

Migration `023` deleted the public read policy and wrote the replacement design
into its own comment. Implement it as written:

```sql
CREATE FUNCTION public.invitation_by_token(p_token TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, role TEXT, expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ ... $$;
```

Returns **no token and no email** — only what the accept screen renders. Never
re-add a public `SELECT` policy on `staff_invitations`; an RLS `USING` clause is
evaluated against the session, not against the caller's `WHERE`, so filtering by
token client-side narrows the response and not the grant. That was the original
CRITICAL finding.

`GET /api/invitations/[token]` is rate-limited. It is a guessing oracle; the
tokens are 32 random bytes so this is belt-and-braces, but cheap.

### 6.2 Invitation scope

An invitation has to carry the scope the person will land with, or every accept
becomes a second manual step:

```sql
CREATE TABLE invitation_scopes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES staff_invitations(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  facility_id   UUID REFERENCES facilities(id)  ON DELETE CASCADE,
  CHECK (num_nonnulls(department_id, facility_id) = 1)
);
```

### 6.3 Accept — one transaction

`public.accept_invitation(p_token TEXT)`, `SECURITY DEFINER`, running as the
signed-in invitee. In a single statement it must: validate the token is unused
and unexpired, create the `org_memberships` row with the invited role and the
caller's email snapshot, copy `invitation_scopes` → `membership_scopes`, and
stamp `accepted_at`.

A partial failure here is a member with no scope (locked out, recoverable) or a
consumed token with no member (locked out, *not* recoverable without support).
One function, one transaction.

It must also **re-validate the email**: the invitation was sent to an address,
and the accepting session must own that address. Otherwise a forwarded link lets
anyone in.

### 6.4 Getting the person an account — the real blocker

| Mail | Provider | Limit |
|---|---|---|
| The invitation itself | Resend (`RESEND_API_KEY`) | fine |
| **The signup confirmation the invitee then needs** | **Supabase built-in mailer** | **~2 / hour, org-wide, then silent failure** |

The invitation email is ours and is not rate-limited in any meaningful way. But
a brand-new lifeguard still has to create an auth account, and that email goes
through Supabase's built-in mailer — which is
[launch blocker 1 in `RESUME.md`](RESUME.md), unresolved across four sessions.

**Onboarding a shift's worth of staff will silently fail on the third person
until custom SMTP is configured.** No amount of code here fixes that; it is a
dashboard setting (Project Settings → Auth → SMTP). Build the flow, ship it,
and treat staff onboarding as demo-only until SMTP is done.

Mitigation that does help: the invite link carries the token *through* signup
(`/callback?next=/invite/<token>`), so a new staff member costs exactly one
Supabase email rather than two round trips. And an invitee who already has an
account costs zero.

`RESEND_API_KEY` and `RESEND_FROM_EMAIL` are in `.env.example` but **not in
`.env.local`**, and `resend` currently appears in exactly one file (the Stripe
webhook). Adding them is part of this work.

---

## 7. The NULL-department problem

Coordinator authority is expressed through `departments`. Two things in the
live database are not attached to one:

- **`Pickleball Open Play`** — a schedule group with `department_id IS NULL`.
  `schedule_groups.department_id` was made nullable by migration `011` on
  purpose, and the nullability is still correct.
- **11 of 23 spaces** with `department_id IS NULL` (Test Rec Centre's 8 lanes
  and 3 others).

Under §4, no Coordinator can ever reach them — `can_write_schedule_group()`
returns `FALSE` for a NULL department. That is the right default and the wrong
experience: the schedule simply is not there, with no explanation.

Three things ship with this:

1. Those rows stay **owner/manager-only**, by design. Not a bug to fix in RLS.
2. `/dashboard/departments` grows an **"Unassigned" callout** listing schedule
   groups and spaces with no department, with a one-click assign — this is
   worth having regardless of roles.
3. The Coordinator's empty state says *"This schedule has no department, so it
   is managed by an organization Manager"* rather than rendering nothing.

---

## 8. What gets built

### 8.1 Migrations

- `055_staff_roles_and_scopes.sql` — §5 in full
- `056_invitation_flow.sql` — §6: `invitation_scopes`, `invitation_by_token()`,
  `accept_invitation()`, role CHECK on `staff_invitations`
- rollbacks for both, per repo convention

### 8.2 Pages

| Route | Who | What |
|---|---|---|
| `/dashboard/staff` | Owner, Manager (Coordinator sees own scope) | Members + pending invites, role badges, scope chips, invite dialog, change role, remove, resend, revoke |
| `/invite/[token]` | public | Accept screen. Signed out → sign up/in and return here. Signed in with the right address → one button |
| `/dashboard/settings` | Owner | New danger zone: transfer ownership (confirm by typing the org name) |
| `/dashboard/schedule` | Aux | Read-only mode — no drag, no add, no settings, no week-approve |
| `/dashboard` | Aux | Redirect straight to their facility's schedule |

The invite dialog is a **dialog, not a page** — mobile-first, per the standing
requirement.

### 8.3 API routes

```
POST   /api/staff/invitations              create + send        owner|manager|coordinator(aux only)
DELETE /api/staff/invitations/[id]         revoke
POST   /api/staff/invitations/[id]/resend  re-send
GET    /api/invitations/[token]            public, rate-limited, no secrets
POST   /api/invitations/[token]/accept     authenticated invitee
PATCH  /api/staff/members/[id]             role + scopes        owner|manager
DELETE /api/staff/members/[id]             remove               owner|manager
POST   /api/staff/members/leave            leave the org        anyone but the owner
POST   /api/staff/transfer-ownership       owner only
```

### 8.4 Application layer

- **Revive `src/lib/auth/roles.ts`** as the single source of truth —
  `can(ctx, action, scope)` — and delete the dead `hasRole`/`isAdmin`.
- Replace **~30 inline `["owner","admin"].includes(...)`** checks with it.
  They are currently correct; they become wrong the moment `coordinator` exists,
  because a Coordinator would be silently refused everywhere.
- **Add scope checks to every route that only checks role today.** A Coordinator
  passing the role check is not yet authorized — the route must also confirm the
  target row is in their scope. This is the largest and most error-prone part of
  the work.
- `getOrgContext()` returns scopes alongside the membership, so pages and the
  sidebar make one query, not two.
- `SidebarMenu`, `DashboardBottomNav` and `SidebarFilters` filter by role.

---

## 9. Verification — `verify-al.mjs`

Per `scripts/verify/README.md`: service-role fixtures, but **act as a genuinely
signed-in user of each role**, always with a positive control, and assert the
mechanism rather than the outcome.

The non-negotiable part: **every deny case must be tested against PostgREST
directly, not through the API routes.** The API check and the RLS policy are two
different controls, and the whole reason migration `024` exists is that the app
layer alone was not enough. A test that only proves the button is hidden proves
nothing.

The matrix, at minimum:

- Coordinator **can** edit a session in their department — *positive control*
- Coordinator **cannot** edit a session in a sibling department, via PostgREST
- Coordinator **cannot** create a facility, a department, or touch the widget
- Coordinator with **zero scopes** can write nothing (§4)
- Aux **can** read their facility's internal schedule
- Aux **cannot** write anything, anywhere — sessions especially (§5.5)
- Aux **cannot** read `session_internal` for another facility
- Manager **cannot** reach billing, delete the org, or remove the Owner
- Manager **can** remove another Manager
- Nobody can change their own role
- An accepted invitation lands the exact role and scopes it carried
- A token cannot be redeemed twice, after expiry, or by the wrong address
- `staff_invitations` returns **nothing** to anon through PostgREST (regression
  guard on migration `023`)

Each assertion gets deliberately broken once to prove it catches what it claims,
per house rule.

---

## 10. Decisions taken, so they are not relitigated

| Decision | Why |
|---|---|
| Owner separate from Manager | A Manager must not be able to cancel the subscription or lock the founder out. |
| Managers can remove Managers | Otherwise the role ratchets — peers add peers, only one person prunes. |
| Coordinator scoped by **department** | That is the unit of real responsibility, and it is already the unit the schema uses. |
| Aux scoped by **facility** | A receptionist serves a building. Also avoids the NULL-department hole in §7. |
| Coordinators may invite Aux only, within scope | Seasonal hiring must not funnel through the Owner. They can never mint a peer or escape their scope. |
| Aux get a stripped view, not a disabled one | Every future feature would otherwise have to remember to disable itself. |
| Empty scope = **no** access | Fail closed. Non-negotiable — see §4. |
| Scopes in one table with real FKs | Cascades are automatic; orphan rows are impossible. |
| No seat limits, no per-user billing | `docs/PRICING.md` prices the **facility** and makes staff unlimited on every tier, deliberately. Nothing here changes that. |
| Retire `admin` / `member` outright | Zero rows exist. It will never be cheaper. |

---

## 11. What shipped

| | |
|---|---|
| ✅ | `055_staff_roles_and_scopes.sql` + rollback — roles, `membership_scopes`, six helpers, the §5.5 hole, the §5.6 bugs, `transfer_ownership()` |
| ✅ | `056_invitation_flow.sql` + rollback — `invitation_scopes`, `invitation_by_token()`, `accept_invitation()`, `leave_organization()` |
| ✅ | `lib/auth/roles.ts` rewritten as `can()` over 26 permissions; `guard.ts`; `scope-lookup.ts` |
| ✅ | **All ~30 inline `["owner","admin"].includes()` checks converted.** None remain |
| ✅ | `sessions`, `sessions/[sessionId]`, and its `exceptions` route gated — they had **no role check at all** before |
| ✅ | `getOrgContext()` / `getRouteMembership()` carry scopes, on the same round trip |
| ✅ | `/dashboard/staff`, the invite dialog, the edit-access dialog, `/invite/[token]` |
| ✅ | 9 API routes under `/api/staff` and `/api/invitations` |
| ✅ | Sidebar, mobile bottom nav, aux landing redirect, read-only command centre |
| ✅ | `scripts/verify/verify-al.mjs` |
| ✅ | **Migrations applied, `verify-al` 41/41**, five assertions falsified |
| ✅ | The §7 "Unassigned" callout on `/dashboard/departments` — shown only when the org actually has a coordinator |
| ✅ | The department-delete notice naming coordinators who just lost all access (§5.3 cascade trap) |
| ✅ | Transfer-ownership UI on `/dashboard/settings`, owner-only, confirm-by-typing |
| ✅ | `ScheduleGroupForm` — **no fix needed.** Migration 024's warning was stale: the form posts to `/api/schedule-groups` and gets the route's own permission message. Checked 2026-09-18; no direct client write to any resource table remains |
| ⬜ | `RESEND_API_KEY` / `RESEND_FROM_EMAIL` in `.env.local` |

### One bug this work introduced and fixed

The staff list rendered an invitation's expiry with `toLocaleDateString()`,
which follows each runtime's locale — `2026-09-25` from Node, `25/09/2026` in
the browser — and React reported a hydration mismatch. Caught by a browser
render check, not by `tsc`, `eslint` or `next build`, all of which were green.
Now uses `formatDate()` from `lib/utils/dates.ts`, whose fixed format string
renders identically in both.

### Two behaviour changes worth knowing about

- **Billing is now owner-only.** It was `owner|admin`; a Manager is the new
  `admin` and cannot reach it. Deliberate (§2), but it is a real change for
  anyone who was an `admin` — which, today, is nobody.
- **`/api/spaces/reorder` is manager-level, not department-scoped**, because it
  rewrites `display_order` across a whole facility. A coordinator reordering
  their own department would renumber everyone else's spaces.
