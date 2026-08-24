import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import ActivityLogView from "@/components/activity/ActivityLogView";
import type { ActivityEntry } from "@/components/activity/types";

const PAGE_SIZE = 30;

/**
 * /dashboard/activity — every logged change across facilities, departments,
 * spaces, schedules, sessions and session templates for this org, newest
 * first, with a revert option for owners/admins. See 038_activity_log.sql
 * for what writes here and why.
 */
export default async function ActivityPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_log")
    .select("*")
    .eq("org_id", orgContext.org.id)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const entries = (data ?? []) as ActivityEntry[];
  const nextCursor = entries.length === PAGE_SIZE ? entries[entries.length - 1].created_at : null;
  const canRevert = orgContext.membership.role === "owner" || orgContext.membership.role === "admin";

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Activity log</h1>
        <p className="text-gray-500 mt-1">
          Every change to your facilities, schedules and sessions, and who made it.
        </p>
      </div>
      <ActivityLogView initialEntries={entries} initialCursor={nextCursor} canRevert={canRevert} />
    </div>
  );
}
