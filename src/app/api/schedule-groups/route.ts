import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

/**
 * GET /api/schedule-groups?departmentId=... — list schedule groups
 * (optionally scoped to a department). Used by department/facility pickers
 * (ScheduleGroupForm, WidgetConfigurator). Creation happens directly via
 * ScheduleGroupForm's Supabase client write, not through this route.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const departmentId = new URL(request.url).searchParams.get("departmentId");

  let query = supabase
    .from("schedule_groups")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("display_order", { ascending: true });

  if (departmentId) query = query.eq("department_id", departmentId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load schedule groups" }, { status: 500 });
  return NextResponse.json({ scheduleGroups: data ?? [] });
}
