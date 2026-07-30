import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { expandSessions, type SessionWithRelations } from "@/lib/rrule/expand";
import { getWeekStart, getWeekEnd } from "@/lib/utils/dates";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Building2,
  Calendar,
  ArrowRight,
  EyeOff,
  Inbox,
  Plus,
  Layers,
  Clock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type RecentFacility = {
  id: string;
  name: string;
  is_published: boolean;
  updated_at: string;
  kind: "facility";
};

type RecentScheduleGroup = {
  id: string;
  name: string;
  is_published: boolean;
  updated_at: string;
  facility_id: string;
  department_id: string | null;
  kind: "schedule_group";
};

type RecentItem = RecentFacility | RecentScheduleGroup;

type AttentionItem = {
  key: string;
  label: string;
  detail: string;
  href: string;
};

function settledCount(
  result: PromiseSettledResult<{ count: number | null; error: unknown }>
): number | null {
  if (result.status !== "fulfilled" || result.value.error) return null;
  return result.value.count ?? 0;
}

function scheduleGroupHref(sg: { facility_id: string; department_id: string | null; id: string }) {
  return sg.department_id
    ? `/dashboard/facilities/${sg.facility_id}/departments/${sg.department_id}/schedule-groups/${sg.id}`
    : `/dashboard/facilities/${sg.facility_id}/schedule-groups/${sg.id}`;
}

export default async function DashboardPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();

  const now = new Date();
  const weekStart = getWeekStart(now);
  const weekEnd = getWeekEnd(now);

  // Every query is settled independently so one failure can't blank the whole page.
  const [
    facilitiesRes,
    thisWeekRes,
    recentFacilitiesRes,
    recentScheduleGroupsRes,
    draftFacilitiesRes,
    draftScheduleGroupsRes,
    emptyFacilitiesRes,
  ] = await Promise.allSettled([
    supabase.from("facilities").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase
      .from("sessions")
      .select(
        `*, schedule_groups!inner ( id, name, sport_category, activity_type, cost_cents, cost_notes,
          age_group, skill_level, max_participants, is_published, org_id,
          facilities ( id, name ), departments ( id, name ) ),
        session_spaces ( spaces ( id, name, display_order ) )`
      )
      .eq("org_id", orgId)
      .eq("is_active", true)
      .lte("valid_from", weekEnd.toISOString().split("T")[0])
      .or(`valid_until.is.null,valid_until.gte.${weekStart.toISOString().split("T")[0]}`),
    supabase
      .from("facilities")
      .select("id, name, is_published, updated_at")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(8) as unknown as Promise<{
      data: Omit<RecentFacility, "kind">[] | null;
      error: unknown;
    }>,
    supabase
      .from("schedule_groups")
      .select("id, name, is_published, updated_at, facility_id, department_id")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(8) as unknown as Promise<{
      data: Omit<RecentScheduleGroup, "kind">[] | null;
      error: unknown;
    }>,
    // Needs attention: unpublished facilities
    supabase
      .from("facilities")
      .select("id, name, updated_at")
      .eq("org_id", orgId)
      .eq("is_published", false)
      .order("updated_at", { ascending: false })
      .limit(5) as unknown as Promise<{
      data: { id: string; name: string; updated_at: string }[] | null;
      error: unknown;
    }>,
    // Needs attention: unpublished (draft) schedules
    supabase
      .from("schedule_groups")
      .select("id, name, facility_id, department_id, updated_at")
      .eq("org_id", orgId)
      .eq("is_published", false)
      .order("updated_at", { ascending: false })
      .limit(5) as unknown as Promise<{
      data: { id: string; name: string; facility_id: string; department_id: string | null; updated_at: string }[] | null;
      error: unknown;
    }>,
    // Needs attention: facilities with no departments and no schedule groups
    supabase
      .from("facilities")
      .select("id, name, departments(id), schedule_groups(id)")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(20) as unknown as Promise<{
      data: { id: string; name: string; departments: { id: string }[]; schedule_groups: { id: string }[] }[] | null;
      error: unknown;
    }>,
  ]);

  const facilityCount = settledCount(facilitiesRes);

  const thisWeekCount =
    thisWeekRes.status === "fulfilled" && !thisWeekRes.value.error && thisWeekRes.value.data
      ? expandSessions(thisWeekRes.value.data as unknown as SessionWithRelations[], [], {
          weekStart,
          weekEnd,
          orgId,
        }).length
      : null;

  const recentFacilities: RecentFacility[] =
    recentFacilitiesRes.status === "fulfilled" && recentFacilitiesRes.value.data
      ? recentFacilitiesRes.value.data.map((f) => ({
          id: f.id,
          name: f.name,
          is_published: f.is_published,
          updated_at: f.updated_at,
          kind: "facility" as const,
        }))
      : [];
  const recentScheduleGroups: RecentScheduleGroup[] =
    recentScheduleGroupsRes.status === "fulfilled" && recentScheduleGroupsRes.value.data
      ? recentScheduleGroupsRes.value.data.map((sg) => ({
          id: sg.id,
          name: sg.name,
          is_published: sg.is_published,
          updated_at: sg.updated_at,
          facility_id: sg.facility_id,
          department_id: sg.department_id,
          kind: "schedule_group" as const,
        }))
      : [];

  const recentActivity: RecentItem[] = [...recentFacilities, ...recentScheduleGroups]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 8);

  // Needs attention — three signals, each capped and merged into one list.
  const attentionItems: AttentionItem[] = [];

  if (draftFacilitiesRes.status === "fulfilled" && draftFacilitiesRes.value.data) {
    for (const f of draftFacilitiesRes.value.data) {
      attentionItems.push({
        key: `draft_facility_${f.id}`,
        label: f.name,
        detail: "Facility is unpublished",
        href: `/dashboard/facilities/${f.id}`,
      });
    }
  }

  if (draftScheduleGroupsRes.status === "fulfilled" && draftScheduleGroupsRes.value.data) {
    for (const sg of draftScheduleGroupsRes.value.data) {
      attentionItems.push({
        key: `draft_schedule_${sg.id}`,
        label: sg.name,
        detail: "Schedule is unpublished",
        href: scheduleGroupHref(sg),
      });
    }
  }

  if (emptyFacilitiesRes.status === "fulfilled" && emptyFacilitiesRes.value.data) {
    for (const f of emptyFacilitiesRes.value.data) {
      if (f.departments.length === 0 && f.schedule_groups.length === 0) {
        attentionItems.push({
          key: `empty_facility_${f.id}`,
          label: f.name,
          detail: "No departments or schedules yet",
          href: `/dashboard/facilities/${f.id}`,
        });
      }
    }
  }

  const isNew = facilityCount === 0;
  // Departments/schedules are created within a facility, so quick-build routes
  // there via whichever facility was touched most recently.
  const mostRecentFacilityId = recentFacilities[0]?.id ?? null;

  function itemHref(item: RecentItem) {
    return item.kind === "facility" ? `/dashboard/facilities/${item.id}` : scheduleGroupHref(item);
  }

  const quickBuildActions = [
    { label: "Add facility", icon: Building2, href: "/dashboard/facilities/new" },
    ...(mostRecentFacilityId
      ? [
          {
            label: "Add department",
            icon: Layers,
            href: `/dashboard/facilities/${mostRecentFacilityId}/departments/new`,
          },
          {
            label: "Add schedule",
            icon: Calendar,
            href: `/dashboard/facilities/${mostRecentFacilityId}/schedule-groups/new`,
          },
        ]
      : []),
    { label: "Add session", icon: Clock, href: "/dashboard/sessions/new" },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back{isNew ? "" : `, ${orgContext.org.name}`}
        </h1>
        <p className="text-gray-500 mt-1">
          {isNew
            ? "Get started by adding your first facility."
            : "Here's what's happening across your organization."}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Facilities", value: facilityCount, icon: Building2, href: "/dashboard/facilities" },
          { label: "This week", value: thisWeekCount, icon: Calendar, href: "/dashboard/schedule" },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="p-5 hover:border-blue-300 hover:shadow-sm transition-all group">
              <div className="flex items-center justify-between mb-3">
                <stat.icon className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
              </div>
              {stat.value === null ? (
                <p
                  className="text-2xl font-bold text-gray-300"
                  title="Couldn't load this right now"
                >
                  –
                </p>
              ) : (
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              )}
              <p className="text-sm text-gray-500 mt-0.5">{stat.label}</p>
            </Card>
          </Link>
        ))}
      </div>

      {/* Quick build — fast entry points into the most common create flows */}
      {!isNew && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick build</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickBuildActions.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="flex flex-col items-center justify-center gap-2 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all text-center"
              >
                <span className="relative w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center">
                  <action.icon className="w-4 h-4 text-blue-600" />
                  <Plus className="w-3 h-3 text-blue-600 absolute -right-1 -bottom-1 bg-white rounded-full border border-blue-100 p-0.5" />
                </span>
                <span className="text-xs font-medium text-gray-700">{action.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions for new orgs */}
      {isNew && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Get started in 3 steps</h2>
          <div className="space-y-3">
            {[
              { step: 1, label: "Add a facility", desc: "Add your rec centre, pool, or arena", href: "/dashboard/facilities/new" },
              { step: 2, label: "Create a schedule", desc: "Add Lap Swim, Drop-in Hockey, or any activity", href: "/dashboard/facilities" },
              { step: 3, label: "Build your schedule", desc: "Set recurring session times for each schedule", href: "/dashboard/schedule" },
            ].map((item) => (
              <Link
                key={item.step}
                href={item.href}
                className="flex items-center gap-4 p-3 bg-white rounded-lg border border-blue-100 hover:border-blue-300 transition-colors group"
              >
                <span className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                  {item.step}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Needs attention — the primary reason to visit the overview day to day */}
      {!isNew && attentionItems.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Needs attention</h2>
          <Card className="divide-y divide-gray-100 py-0">
            {attentionItems.slice(0, 8).map((item) => {
              const Icon = item.key.startsWith("empty_") ? Inbox : EyeOff;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <Icon className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
                    <p className="text-xs text-gray-500 truncate">{item.detail}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
                </Link>
              );
            })}
          </Card>
        </div>
      )}

      {/* Recent activity — every row links directly into the tree at the right node */}
      {!isNew && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent activity</h2>
          {recentActivity.length > 0 ? (
            <Card className="divide-y divide-gray-100 py-0">
              {recentActivity.map((item) => {
                const Icon = item.kind === "facility" ? Building2 : Calendar;
                return (
                  <Link
                    key={`${item.kind}_${item.id}`}
                    href={itemHref(item)}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-sm font-medium text-gray-900 truncate">{item.name}</span>
                    <Badge variant={item.is_published ? "default" : "secondary"} className="shrink-0">
                      {item.is_published ? "Published" : "Draft"}
                    </Badge>
                    <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">
                      {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
                    </span>
                    <ArrowRight className="w-4 h-4 text-gray-300 ml-auto shrink-0" />
                  </Link>
                );
              })}
            </Card>
          ) : (
            <Card className="px-5 py-6 text-center">
              <p className="text-sm text-gray-500">Nothing&apos;s changed recently.</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Updates to your facilities and schedules will show up here.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
