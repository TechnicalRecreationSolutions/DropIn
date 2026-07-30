import Link from "next/link";
import { Plus, Calendar } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import DashboardScheduleClient from "./DashboardScheduleClient";

export default async function SchedulePage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  // Check if they have any schedules to show context-appropriate empty state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from("schedule_groups")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgContext.org.id);

  const hasScheduleGroups = (count ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">This week</h1>
          <p className="text-gray-500 mt-1">Your weekly recurring sessions at a glance.</p>
        </div>
        <Link
          href="/dashboard/sessions/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add session
        </Link>
      </div>

      {!hasScheduleGroups ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
          <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">No schedules yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Add a schedule first, then create recurring sessions for it.
          </p>
          <Link
            href="/dashboard/facilities"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add a schedule
          </Link>
        </div>
      ) : (
        <DashboardScheduleClient orgId={orgContext.org.id} />
      )}
    </div>
  );
}
