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
 * GET /api/nav-tree — the org's full Facility > Department > Schedule Group
 * tree in one shot (ids, names, is_published, parent ids). Powers the
 * dashboard's persistent tree-nav sidebar. Deliberately denormalized and
 * separate from /api/sessions/expand or per-page Supabase calls — the tree
 * needs a cheap full-org shape, not date-scoped session data.
 */
export async function GET() {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [facilitiesRes, departmentsRes, scheduleGroupsRes] = await Promise.all([
    db
      .from("facilities")
      .select("id, name, is_published")
      .eq("org_id", membership.org_id)
      .order("name"),
    db
      .from("departments")
      .select("id, name, is_published, facility_id")
      .eq("org_id", membership.org_id)
      .order("display_order", { ascending: true }),
    db
      .from("schedule_groups")
      .select("id, name, is_published, facility_id, department_id")
      .eq("org_id", membership.org_id)
      .order("display_order", { ascending: true }),
  ]);

  if (facilitiesRes.error || departmentsRes.error || scheduleGroupsRes.error) {
    return NextResponse.json({ error: "Could not load navigation tree" }, { status: 500 });
  }

  return NextResponse.json({
    facilities: facilitiesRes.data ?? [],
    departments: departmentsRes.data ?? [],
    scheduleGroups: scheduleGroupsRes.data ?? [],
  });
}
