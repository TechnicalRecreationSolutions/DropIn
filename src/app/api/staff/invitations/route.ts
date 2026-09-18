import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { can, invitableRolesFor, ROLE_LABELS } from "@/lib/auth/roles";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { sendInvitationEmail, invitationUrl } from "@/lib/staff/invitationEmail";

const InviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(["manager", "coordinator", "aux"]),
  /** Department ids — for a coordinator. */
  departmentIds: z.array(z.string().uuid()).max(100).default([]),
  /** Facility ids — for aux staff. */
  facilityIds: z.array(z.string().uuid()).max(100).default([]),
});

/**
 * POST /api/staff/invitations — invite someone into this organization.
 *
 * The token is NOT generated here. `staff_invitations.token` defaults to
 * `encode(gen_random_bytes(32),'hex')`, generated in Postgres, and migration
 * 001 was deliberate about keeping it out of application code. Nothing below
 * supplies one.
 *
 * ## Why the scope rules are enforced twice
 *
 * A coordinator may invite aux staff, and only into facilities they already
 * hold. Both halves are checked here *and* in RLS (migration 056 §2), because
 * RLS cannot see across two tables in one policy — the role restriction lives
 * on `staff_invitations` and the facility restriction on `invitation_scopes`.
 * Together they are sufficient; this route makes the refusal legible.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const actor = { role: membership.role, scopes: membership.scopes };
  if (!can(actor, "staff:invite-aux")) {
    return NextResponse.json(
      { error: `${ROLE_LABELS[membership.role]} accounts cannot invite people.` },
      { status: 403 }
    );
  }

  // Keyed on the inviter rather than the IP: the risk is one compromised
  // manager account spraying invitations, and a whole recreation centre can
  // sit behind a single IP.
  if (!(await checkRateLimit("staffInvite", user.id))) {
    return rateLimitResponse("staffInvite");
  }

  const body = await request.json().catch(() => null);
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { email, role, departmentIds, facilityIds } = parsed.data;

  if (!invitableRolesFor(membership.role).includes(role)) {
    return NextResponse.json(
      { error: `You cannot invite someone as ${ROLE_LABELS[role]}.` },
      { status: 403 }
    );
  }

  // Each role takes exactly one grain of scope. Accepting the wrong one would
  // produce a membership whose scope rows can never match anything it is asked
  // about — access that looks granted and behaves as denied.
  const scopeIds = role === "coordinator" ? departmentIds : facilityIds;

  if (role !== "manager" && scopeIds.length === 0) {
    return NextResponse.json(
      {
        error:
          role === "coordinator"
            ? "Choose at least one department for this coordinator."
            : "Choose at least one facility for this staff member.",
      },
      { status: 400 }
    );
  }

  // THE RULE: an empty scope grants nothing (docs/PLAN-staff-roles.md §4).
  // The check above is what stops a useless invitation being *sent*; the
  // fail-closed behaviour if one ever is remains the real guarantee.

  // Verify every scope id belongs to this org — a hand-crafted request must not
  // be able to attach another organization's department to an invitation.
  if (role === "coordinator") {
    const { data: owned } = await supabase
      .from("departments")
      .select("id")
      .eq("org_id", membership.org_id)
      .in("id", departmentIds);
    if ((owned?.length ?? 0) !== departmentIds.length) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }
  } else if (role === "aux") {
    const { data: owned } = await supabase
      .from("facilities")
      .select("id")
      .eq("org_id", membership.org_id)
      .in("id", facilityIds);
    if ((owned?.length ?? 0) !== facilityIds.length) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }

    // A coordinator may only place aux staff in buildings they already hold.
    // RLS enforces this too (056 §2), on `invitation_scopes`; this is the copy
    // that can explain itself.
    if (membership.role === "coordinator") {
      const outside = facilityIds.filter((id) => !membership.scopes.facilityIds.includes(id));
      if (outside.length > 0) {
        return NextResponse.json(
          { error: "You can only add staff to the facilities you manage." },
          { status: 403 }
        );
      }
    }
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Already inside? Say so rather than sending a link that accept_invitation()
  // would consume into a no-op.
  const { data: existingMember } = await supabase
    .from("org_memberships")
    .select("id")
    .eq("org_id", membership.org_id)
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingMember) {
    return NextResponse.json(
      { error: "That person is already on your team." },
      { status: 409 }
    );
  }

  const { data: invitation, error } = await supabase
    .from("staff_invitations")
    .insert({
      org_id: membership.org_id,
      email: normalizedEmail,
      role,
      invited_by: user.id,
    })
    .select("id, token, email, role, expires_at, created_at")
    .single();

  if (error) {
    // 23505 is the token's UNIQUE constraint, which is a 1-in-2^256 event, or
    // a repeat invitation to the same address — neither is worth distinguishing
    // to the caller.
    return NextResponse.json({ error: "Could not create the invitation." }, { status: 500 });
  }

  const scopeRows = [
    ...departmentIds.map((id) => ({
      invitation_id: invitation.id,
      org_id: membership.org_id,
      department_id: id,
      facility_id: null,
    })),
    ...facilityIds.map((id) => ({
      invitation_id: invitation.id,
      org_id: membership.org_id,
      department_id: null,
      facility_id: id,
    })),
  ].filter((r) => (role === "coordinator" ? r.department_id : r.facility_id));

  if (scopeRows.length > 0) {
    const { error: scopeError } = await supabase.from("invitation_scopes").insert(scopeRows);

    if (scopeError) {
      // An invitation whose scopes failed to attach would grant nothing on
      // acceptance and burn the token doing it. Remove it rather than leave a
      // trap in the staff list.
      await supabase.from("staff_invitations").delete().eq("id", invitation.id);
      return NextResponse.json(
        { error: "Could not save this person's access. Nothing was sent." },
        { status: 500 }
      );
    }
  }

  const sent = await sendInvitationEmail({
    to: normalizedEmail,
    orgName: (await orgName(supabase, membership.org_id)) ?? "your organization",
    role,
    token: invitation.token,
    inviterEmail: user.email ?? null,
  });

  // The invitation exists either way. A failed send is reported as a fact, not
  // as an error, and the link comes back so the UI can offer "copy link"
  // instead — which is the only thing that works at all until custom SMTP is
  // configured (see lib/staff/invitationEmail.ts).
  return NextResponse.json(
    {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expires_at: invitation.expires_at,
        created_at: invitation.created_at,
      },
      emailSent: sent.ok,
      emailProblem: sent.ok ? null : sent.reason,
      link: invitationUrl(invitation.token),
    },
    { status: 201 }
  );
}

async function orgName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  return data?.name ?? null;
}
