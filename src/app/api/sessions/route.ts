import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const SessionSchema = z.object({
  program_id: z.string().uuid(),
  rrule: z.string().min(1),
  dtstart: z.string().datetime({ offset: true }),
  dtend_time: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().default("America/Edmonton"),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  location_detail: z.string().nullable().optional(),
  sessionId: z.string().uuid().optional(),
});

/** POST /api/sessions — create or update a recurring session */
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

  const { sessionId, ...fields } = parsed.data;

  // Verify org membership and that program belongs to user's org
  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string } | null };

  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  // Confirm program belongs to this org
  const { data: program } = await supabase
    .from("programs")
    .select("id")
    .eq("id", fields.program_id)
    .eq("org_id", membership.org_id)
    .single() as unknown as { data: { id: string } | null };

  if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

  const payload = {
    ...fields,
    org_id: membership.org_id,
    source: "manual" as const,
    is_active: true,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (supabase as any).from("sessions");

  if (sessionId) {
    const { error } = await table.update(payload).eq("id", sessionId).eq("org_id", membership.org_id);
    if (error) return NextResponse.json({ error: "Failed to update session." }, { status: 500 });
    return NextResponse.json({ ok: true, sessionId });
  }

  const { data: session, error } = await table.insert(payload).select("id").single();
  if (error) return NextResponse.json({ error: "Failed to create session." }, { status: 500 });

  return NextResponse.json({ ok: true, sessionId: session.id });
}

/** DELETE /api/sessions?sessionId=uuid — deactivate a session */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string } | null };

  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("sessions")
    .update({ is_active: false })
    .eq("id", sessionId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to delete session." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
