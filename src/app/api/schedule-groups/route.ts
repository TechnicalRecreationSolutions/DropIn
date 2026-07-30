import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function getMembership(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string; role: string } | null };

  return membership;
}

/**
 * GET /api/schedule-groups?departmentId=... — list schedule groups
 * (optionally scoped to a department). Used by department/facility pickers
 * (ScheduleGroupForm, WidgetConfigurator). Creation happens directly via
 * ScheduleGroupForm's Supabase client write, not through this route.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const departmentId = new URL(request.url).searchParams.get("departmentId");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("schedule_groups")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("display_order", { ascending: true });

  if (departmentId) query = query.eq("department_id", departmentId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load schedule groups" }, { status: 500 });
  return NextResponse.json({ scheduleGroups: data ?? [] });
}
