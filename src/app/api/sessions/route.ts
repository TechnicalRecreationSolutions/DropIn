import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { departmentOfSession } from "@/lib/auth/scope-lookup";
import { SessionSchema, writeSession } from "@/lib/sessions/write";

/**
 * POST /api/sessions — create or update a recurring session.
 *
 * The write itself lives in `src/lib/sessions/write.ts`, because
 * `POST /api/sessions/batch` performs the identical write for a pasted block
 * and a second copy of those rules would drift — the operating-hours snapshot,
 * the template and space scoping checks, and the two "absent means leave it
 * alone" contracts were each learned the hard way. This handler is the HTTP
 * shell: authenticate, parse, hand over.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const result = await writeSession(supabase, membership, parsed.data);
  if (!result.ok) return result.response;

  return NextResponse.json({ ok: true, sessionId: result.sessionId });
}

/** DELETE /api/sessions?sessionId=uuid — deactivate a session */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const membership = await getRouteMembership(supabase, user.id);

  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const department = await departmentOfSession(supabase, sessionId, membership.org_id);
  if (department === undefined) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const denied = requirePermission(membership, "session:write", department);
  if (denied) return denied;

  const { error } = await supabase
    .from("sessions")
    .update({ is_active: false })
    .eq("id", sessionId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to delete session." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
