import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { canModifyMembership, invitableRolesFor, ROLE_LABELS } from "@/lib/auth/roles";
import type { OrgRole } from "@/types/app.types";

const UpdateSchema = z.object({
  role: z.enum(["manager", "coordinator", "aux"]).optional(),
  departmentIds: z.array(z.string().uuid()).max(100).optional(),
  facilityIds: z.array(z.string().uuid()).max(100).optional(),
});

/**
 * PATCH /api/staff/members/[id] — change someone's role and/or scope.
 * DELETE /api/staff/members/[id] — remove them from the organization.
 *
 * Both mirror `memberships_managers_update` / `_delete` from migration 055 §7,
 * which encode three rules that had never been exercised before this feature
 * existed:
 *
 *   - the OWNER row is untouchable. `transfer_ownership()` is the only thing
 *     that changes it, and it is SECURITY DEFINER precisely so this policy can
 *     be absolute rather than full of carve-outs.
 *   - nobody edits their OWN row, at any level. That is self-promotion.
 *     Resigning is POST /api/staff/members/leave, deliberately separate so
 *     "a manager removed you" and "you left" stay distinguishable.
 *   - the new role is never `owner`.
 *
 * Managers may demote and remove other Managers — see §2 of the design doc for
 * why the safer-sounding alternative is worse.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const { data: target } = await supabase
    .from("org_memberships")
    .select("id, user_id, role")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const actor = { role: membership.role, scopes: membership.scopes, userId: user.id };
  if (!canModifyMembership(actor, target as { role: OrgRole; user_id: string })) {
    return NextResponse.json({ error: refusal(target.role as OrgRole, target.user_id === user.id) }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const nextRole = (parsed.data.role ?? target.role) as OrgRole;

  if (parsed.data.role && !invitableRolesFor(membership.role).includes(parsed.data.role)) {
    return NextResponse.json(
      { error: `You cannot make someone ${ROLE_LABELS[parsed.data.role]}.` },
      { status: 403 }
    );
  }

  if (parsed.data.role) {
    const { error } = await supabase
      .from("org_memberships")
      .update({ role: parsed.data.role })
      .eq("id", id)
      .eq("org_id", membership.org_id);

    if (error) {
      return NextResponse.json({ error: "Could not change this person's role." }, { status: 500 });
    }
  }

  // Scope is rewritten wholesale rather than diffed: the UI sends the complete
  // list it is showing, and a delete-then-insert is the only way to express a
  // removal with the same call that expresses an addition.
  const scopesProvided =
    parsed.data.departmentIds !== undefined || parsed.data.facilityIds !== undefined;

  if (scopesProvided || parsed.data.role) {
    // A role change makes the old grain meaningless — a coordinator promoted to
    // manager should not keep department rows, and an aux promoted to
    // coordinator must not keep facility rows that now match nothing. Clearing
    // on every role change is what stops a membership carrying scope of a grain
    // its role never consults.
    const departmentIds = nextRole === "coordinator" ? parsed.data.departmentIds ?? [] : [];
    const facilityIds = nextRole === "aux" ? parsed.data.facilityIds ?? [] : [];

    const ids = [...departmentIds, ...facilityIds];
    if (nextRole !== "manager" && ids.length === 0) {
      return NextResponse.json(
        {
          error:
            nextRole === "coordinator"
              ? "A coordinator needs at least one department."
              : "A staff member needs at least one facility.",
        },
        { status: 400 }
      );
    }

    // Every id must belong to this org — otherwise a crafted request attaches
    // another organization's department to a membership here.
    if (departmentIds.length > 0) {
      const { data: owned } = await supabase
        .from("departments")
        .select("id")
        .eq("org_id", membership.org_id)
        .in("id", departmentIds);
      if ((owned?.length ?? 0) !== departmentIds.length) {
        return NextResponse.json({ error: "Department not found" }, { status: 404 });
      }
    }
    if (facilityIds.length > 0) {
      const { data: owned } = await supabase
        .from("facilities")
        .select("id")
        .eq("org_id", membership.org_id)
        .in("id", facilityIds);
      if ((owned?.length ?? 0) !== facilityIds.length) {
        return NextResponse.json({ error: "Facility not found" }, { status: 404 });
      }
    }

    await supabase.from("membership_scopes").delete().eq("membership_id", id);

    const rows = [
      ...departmentIds.map((d) => ({
        membership_id: id,
        org_id: membership.org_id,
        department_id: d,
        facility_id: null,
      })),
      ...facilityIds.map((f) => ({
        membership_id: id,
        org_id: membership.org_id,
        department_id: null,
        facility_id: f,
      })),
    ];

    if (rows.length > 0) {
      const { error } = await supabase.from("membership_scopes").insert(rows);
      if (error) {
        // The delete above already landed, so this person now has NO scope —
        // which under §4 means no access. That is the safe direction to fail,
        // and the message says plainly what state they are in.
        return NextResponse.json(
          {
            error:
              "Could not save their departments. Their access has been cleared — set it again.",
          },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const { data: target } = await supabase
    .from("org_memberships")
    .select("id, user_id, role")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const actor = { role: membership.role, scopes: membership.scopes, userId: user.id };
  if (!canModifyMembership(actor, target as { role: OrgRole; user_id: string })) {
    return NextResponse.json({ error: refusal(target.role as OrgRole, target.user_id === user.id) }, { status: 403 });
  }

  // membership_scopes cascades on membership_id.
  const { error } = await supabase
    .from("org_memberships")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) {
    return NextResponse.json({ error: "Could not remove this person." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function refusal(targetRole: OrgRole, isSelf: boolean): string {
  if (targetRole === "owner") {
    return "The owner's account can only be changed by transferring ownership.";
  }
  if (isSelf) {
    return "You cannot change your own role. To step away, leave the organization instead.";
  }
  return "You cannot manage staff.";
}
