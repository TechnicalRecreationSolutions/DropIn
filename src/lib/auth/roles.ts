import type { OrgRole, OrgScopes } from "@/types/app.types";

/**
 * What each role may do. The single source of truth for the application layer.
 *
 * Design doc: docs/PLAN-staff-roles.md — §3 is this file in table form.
 *
 * **This is the second of two layers, not the only one.** Postgres RLS is the
 * first and the authoritative one: the publishable key ships in the browser
 * bundle, so anything enforced only here can be skipped by calling PostgREST
 * directly. Migration 024 exists because that lesson was learned the hard way,
 * and migration 055 §5 closed the same class of hole for schedule content.
 *
 * So every check here has a matching policy in 055. This layer exists to give
 * a 403 with an explanation instead of an opaque RLS failure, and to decide
 * what the navigation offers — not to be the control.
 *
 * The file this replaces exported `hasRole`/`isAdmin`/`isOwner` and had **zero
 * call sites** in the entire app; the ~30 routes that needed it each inlined
 * `["owner","admin"].includes(membership.role)` instead. That worked while
 * there were two tiers. It silently denies every coordinator the moment a
 * third exists, which is why the conversion is part of this change rather than
 * a follow-up.
 */

/**
 * Every distinct thing a person can attempt.
 *
 * Grouped by what gates it, because that grouping is the actual design:
 * the first group is owner-only, the second is org-wide (owner + manager),
 * the third is scoped (owner + manager everywhere, coordinator inside their
 * departments), and the fourth is readable by everyone including aux staff.
 */
export type Permission =
  // ── Owner only: the four powers that can end an organization ───────────────
  | "billing:manage"
  | "org:delete"
  | "org:transfer-ownership"

  // ── Org-wide structural: owner + manager ──────────────────────────────────
  | "org:edit-settings"
  | "facility:create"
  | "facility:edit"
  | "facility:delete"
  | "department:create"
  | "department:delete"
  | "map:edit"
  | "widget:edit"
  | "analytics:view"
  | "operations:view"
  | "import:use"
  | "activity:revert"
  | "staff:manage"
  | "tag:manage"

  // ── Department-scoped: owner + manager org-wide, coordinator inside scope ──
  | "department:edit"
  | "schedule-group:write"
  | "session:write"
  | "session-template:write"
  | "space:write"
  | "week-review:write"
  | "conflict:dismiss"
  | "tag:create"
  | "staff:invite-aux"

  // ── Operational, and the only things an aux staffer may WRITE ─────────────
  | "reading:write"
  | "notice:write"

  // ── Readable by every role, aux included ──────────────────────────────────
  | "schedule:view-internal"
  | "activity:view"
  | "staff:view";

/**
 * Roles that satisfy each permission BEFORE scope is considered.
 *
 * Passing this test is necessary and, for a coordinator on a scoped
 * permission, **not sufficient** — the caller must also pass the relevant
 * scope id to `can()`. Forgetting that is the easiest mistake to make in this
 * whole change, so `requiresScope()` below names the permissions where it
 * matters and `can()` fails closed when a coordinator omits one.
 */
const ALLOWED: Record<Permission, readonly OrgRole[]> = {
  "billing:manage": ["owner"],
  "org:delete": ["owner"],
  "org:transfer-ownership": ["owner"],

  "org:edit-settings": ["owner", "manager"],
  "facility:create": ["owner", "manager"],
  "facility:edit": ["owner", "manager"],
  "facility:delete": ["owner", "manager"],
  "department:create": ["owner", "manager"],
  "department:delete": ["owner", "manager"],
  // The floorplan is a property of the building, not of a department — two
  // coordinators sharing a pool would otherwise fight over one drawing.
  "map:edit": ["owner", "manager"],
  // widget_configs has been ONE ROW PER ORG since migration 045, so a
  // coordinator editing it would rebrand every facility in the organization.
  "widget:edit": ["owner", "manager"],
  "analytics:view": ["owner", "manager"],
  // Engagement is a marketing number; utilization and attendance are the
  // operating picture, and a coordinator filling a schedule is exactly who
  // needs them. Splitting them is why this permission exists separately —
  // widening "analytics:view" would have handed coordinators the visitor
  // analytics too.
  "operations:view": ["owner", "manager", "coordinator"],
  "import:use": ["owner", "manager"],
  // Viewing history is scoped; undoing someone else's change is not.
  "activity:revert": ["owner", "manager"],
  "staff:manage": ["owner", "manager"],
  // Creating a tag is scoped work (see "tag:create"); RENAMING or DELETING one
  // is not — tags are org-wide and every schedule already carrying it changes.
  "tag:manage": ["owner", "manager"],

  "department:edit": ["owner", "manager", "coordinator"],
  "schedule-group:write": ["owner", "manager", "coordinator"],
  "session:write": ["owner", "manager", "coordinator"],
  "session-template:write": ["owner", "manager", "coordinator"],
  "space:write": ["owner", "manager", "coordinator"],
  "week-review:write": ["owner", "manager", "coordinator"],
  "conflict:dismiss": ["owner", "manager", "coordinator"],
  "tag:create": ["owner", "manager", "coordinator"],
  "staff:invite-aux": ["owner", "manager", "coordinator"],

  // Recording a head count or a water temperature is an OBSERVATION, not
  // schedule content — the guard on deck is the only person who can make it,
  // and every role above them can too. This is the first write an aux staffer
  // has ever had, and it is deliberately the narrowest possible one: an
  // append-only row in facility_readings, which nothing else reads from.
  "reading:write": ["owner", "manager", "coordinator", "aux"],
  // NOT the whole answer for an aux staffer — see canWriteNotice() below,
  // which is what every call site must actually use. Listing aux here would
  // be a lie in the common case (the org flag defaults off); omitting aux
  // would make the flag unreachable. So this entry answers the role question
  // only, and the helper answers the real one.
  "notice:write": ["owner", "manager", "coordinator", "aux"],

  "schedule:view-internal": ["owner", "manager", "coordinator", "aux"],
  "activity:view": ["owner", "manager", "coordinator"],
  "staff:view": ["owner", "manager", "coordinator"],
};

/**
 * The permissions whose answer depends on *which* department is being touched.
 *
 * A coordinator asking about one of these without naming a department is
 * asking an unanswerable question, and `can()` answers `false` — the §4
 * fail-closed rule applied to the application layer. Owners and managers are
 * unscoped, so the department is irrelevant to them and may be omitted.
 */
const SCOPED: ReadonlySet<Permission> = new Set<Permission>([
  "department:edit",
  "schedule-group:write",
  "session:write",
  "session-template:write",
  "space:write",
  "week-review:write",
  "conflict:dismiss",
]);

export function requiresScope(permission: Permission): boolean {
  return SCOPED.has(permission);
}

/** The subject of a permission question: who is asking, and what they hold. */
export type Actor = {
  role: OrgRole;
  scopes: OrgScopes;
};

/**
 * True when this role is confined to its scope lists.
 *
 * Owners and managers carry empty scope arrays, and those empty arrays mean
 * "not scoped" rather than "sees nothing". Filtering on the arrays without
 * asking this first inverts the permission model and hides everything from
 * exactly the two roles that should see all of it — so ask this, every time.
 */
export function isScoped(role: OrgRole): boolean {
  return role === "coordinator" || role === "aux";
}

/**
 * True when this role may not write any SCHEDULE CONTENT, anywhere.
 *
 * The right page-level gate for every editing surface — the command centre,
 * the canvas, the session and template forms — and the reason it exists rather
 * than `can(…, "session:write")` is that the latter is department-scoped and
 * answers false for a coordinator asked without one.
 *
 * **It is not "this role cannot write at all".** Since migration 060/061 an aux
 * staffer may record head counts and temperatures (`reading:write`) and, when
 * their organization has opted in, post facility notices (`canWriteNotice`).
 * Gating either of those on this function would hide them from the one role
 * they were built for, so ask the permission directly there.
 */
export function isReadOnly(role: OrgRole): boolean {
  return role === "aux";
}

/**
 * May this actor do this thing?
 *
 * `departmentId` is required for every permission in `SCOPED` when the actor
 * is scoped. Pass the department of the row being touched — for a session or
 * a week review that is its schedule group's department, resolved by the
 * caller, since only the caller knows which row it means.
 *
 * A `null` departmentId is a real answer, not a missing one: it is what a
 * schedule group with no department looks like (migration 011 made that
 * column nullable and `Pickleball Open Play` is one today). Those rows are
 * owner/manager territory, and a coordinator is correctly refused — mirroring
 * `can_write_department(NULL)` returning FALSE in the database.
 */
export function can(
  actor: Actor,
  permission: Permission,
  departmentId?: string | null
): boolean {
  if (!ALLOWED[permission].includes(actor.role)) return false;

  if (!isScoped(actor.role)) return true;
  if (!SCOPED.has(permission)) return true;

  // Scoped role, scoped permission: the department decides, and an unnamed or
  // department-less target decides against.
  if (!departmentId) return false;
  return actor.scopes.departmentIds.includes(departmentId);
}

/**
 * May this actor read this facility's internal data?
 *
 * Mirrors `can_read_facility()` in migration 055. Managers and owners are
 * unscoped; everyone else must hold the facility, either explicitly (aux) or
 * through one of their departments (coordinator — the server derives that
 * union in `user_scope_facility_ids()`).
 */
export function canReadFacility(actor: Actor, facilityId: string): boolean {
  if (!isScoped(actor.role)) return true;
  return actor.scopes.facilityIds.includes(facilityId);
}

/**
 * May this actor post or clear a public notice on this facility?
 *
 * **Use this, never `can(actor, "notice:write")` on its own.** A notice is the
 * one thing whose answer depends on a setting rather than only on a role:
 * `organizations.aux_can_post_notices` (migration 060) decides whether the
 * lifeguard who found the contamination may close the pool to the public, or
 * has to phone a supervisor. Both are defensible, so each organization answers
 * for itself, and the default is no.
 *
 * Mirrors `public.can_write_notice()` in 060, which is the control — this is
 * the layer that turns a refusal into a sentence and hides a button nobody can
 * press.
 *
 * Scoping note: a notice is a FACILITY-level object, so a coordinator is
 * checked against `scopes.facilityIds` — the union the server derives in
 * `user_scope_facility_ids()` — and not against their department list. A
 * contaminated pool is not an Aquatics-only fact.
 */
export function canWriteNotice(
  actor: Actor,
  org: { auxCanPostNotices: boolean },
  facilityId?: string | null
): boolean {
  if (actor.role === "owner" || actor.role === "manager") return true;
  if (actor.role === "aux" && !org.auxCanPostNotices) return false;
  if (actor.role !== "coordinator" && actor.role !== "aux") return false;

  // Scoped from here down, so an unnamed facility is an unanswerable question
  // and answers no — the same fail-closed rule `can()` applies to departments.
  if (!facilityId) return false;
  return actor.scopes.facilityIds.includes(facilityId);
}

/**
 * Which roles this actor may hand out in an invitation.
 *
 * Owners and managers may invite peers; managers may invite other managers on
 * purpose (see §2 of the design doc — a role that can be added but only
 * removed by one person ratchets upward). Coordinators may invite aux staff
 * only, and migration 056's RLS restricts the scopes they can attach to the
 * facilities they already hold.
 */
export function invitableRolesFor(role: OrgRole): OrgRole[] {
  if (role === "owner" || role === "manager") {
    return ["manager", "coordinator", "aux"];
  }
  if (role === "coordinator") return ["aux"];
  return [];
}

/**
 * May this actor change or remove that membership?
 *
 * Mirrors the `memberships_managers_update` / `_delete` policies in 055 §7:
 *
 *   - the OWNER row is untouchable (transfer_ownership() is the only way)
 *   - nobody may edit their OWN row, at any level — that is self-promotion,
 *     and "leave the organization" is a separate, explicit route
 *   - otherwise owner and manager may act on anyone
 */
export function canModifyMembership(
  actor: Actor & { userId: string },
  target: { role: OrgRole; user_id: string }
): boolean {
  if (target.role === "owner") return false;
  if (target.user_id === actor.userId) return false;
  return can(actor, "staff:manage");
}

/** Human-readable role names, for badges and the invite picker. */
export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  manager: "Manager",
  coordinator: "Coordinator",
  aux: "Staff",
};

/** One line each, shown under the role in the invite picker. */
export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: "Full control, including billing. One per organization.",
  manager: "Manages everything except billing.",
  coordinator: "Runs the schedules in the departments you choose.",
  aux: "Views schedules, and records head counts and temperatures. For lifeguards, instructors and front desk.",
};

/**
 * Which roles satisfy this permission, before scope.
 *
 * Exported so the Permissions settings page can RENDER the model rather than
 * restate it. A hand-written "what each role can do" table is a second source
 * of truth that drifts the first time a permission moves between groups, and
 * it drifts silently — nothing fails, the table just starts lying to the
 * manager deciding who to invite. Reading `ALLOWED` means the table is wrong
 * only if the product is wrong.
 *
 * The answer ignores scope, which is correct for a reference table: a
 * coordinator's "yes" to `session:write` is real, and the departments it
 * applies to are a property of that person's account rather than of the role.
 * The table says so in words.
 */
export function rolesWith(permission: Permission): readonly OrgRole[] {
  return ALLOWED[permission];
}
