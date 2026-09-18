import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { isScoped } from "@/lib/auth/roles";

/**
 * GET /api/nav-tree — the org's full Facility > Department > Schedule Group
 * tree in one shot (ids, names, is_published, parent ids). Powers the
 * dashboard's persistent tree-nav sidebar. Deliberately denormalized and
 * separate from /api/sessions/expand or per-page Supabase calls — the tree
 * needs a cheap full-org shape, not date-scoped session data.
 *
 * Since migration 055 it also carries the CALLER'S ROLE. The sidebar has to
 * know it — an aux staffer must not be offered Billing, Spaces or the widget
 * — and this response is already fetched on every dashboard load and cached by
 * TanStack Query, so riding along costs nothing. Hiding a link is presentation,
 * not a control: every route it points at enforces the same rule server-side.
 *
 * Aux staff additionally see only the facilities they are scoped to. That one
 * IS a narrowing of data rather than of chrome, so it is applied here rather
 * than in the component.
 */
export async function GET() {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [facilitiesRes, departmentsRes, scheduleGroupsRes] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, is_published")
      .eq("org_id", membership.org_id)
      .order("name"),
    supabase
      .from("departments")
      .select("id, name, is_published, facility_id")
      .eq("org_id", membership.org_id)
      .order("display_order", { ascending: true }),
    supabase
      .from("schedule_groups")
      .select("id, name, status, facility_id, department_id")
      .eq("org_id", membership.org_id)
      .order("display_order", { ascending: true }),
  ]);

  if (facilitiesRes.error || departmentsRes.error || scheduleGroupsRes.error) {
    return NextResponse.json({ error: "Could not load navigation tree" }, { status: 500 });
  }

  // Aux staff are scoped to buildings. `isScoped()` rather than a bare check
  // on the array: an owner or manager carries an EMPTY scope list, which means
  // "not scoped", and filtering on it directly would leave them with no
  // facilities at all.
  const limit = isScoped(membership.role) ? new Set(membership.scopes.facilityIds) : null;

  const facilities = (facilitiesRes.data ?? []).filter((f) => !limit || limit.has(f.id));
  const departments = (departmentsRes.data ?? []).filter((d) => !limit || limit.has(d.facility_id));
  const scheduleGroups = (scheduleGroupsRes.data ?? []).filter(
    (g) => !limit || limit.has(g.facility_id)
  );

  return NextResponse.json({
    role: membership.role,
    facilities,
    departments,
    scheduleGroups,
  });
}
