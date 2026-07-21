import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Building2, Dumbbell, Calendar, Upload, ArrowRight, AlertCircle } from "lucide-react";

export default async function DashboardPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  // Fetch counts for the overview cards
  const [facilitiesRes, programsRes, conflictsRes] = await Promise.all([
    supabase
      .from("facilities")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgContext.org.id),
    supabase
      .from("programs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgContext.org.id),
    supabase
      .from("scraping_conflicts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgContext.org.id)
      .is("resolution", null),
  ]);

  const facilityCount = facilitiesRes.count ?? 0;
  const programCount = programsRes.count ?? 0;
  const conflictCount = conflictsRes.count ?? 0;

  const isNew = facilityCount === 0;

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
            : "Here's an overview of your organization on Dropin."}
        </p>
      </div>

      {/* Unresolved conflicts banner */}
      {conflictCount > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              {conflictCount} unresolved scraping conflict{conflictCount !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Review and resolve these to keep your schedule data accurate.
            </p>
          </div>
          <Link
            href="/dashboard/import/scraper"
            className="text-xs font-medium text-amber-700 hover:text-amber-900 shrink-0"
          >
            Review →
          </Link>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Facilities", value: facilityCount, icon: Building2, href: "/dashboard/facilities" },
          { label: "Programs", value: programCount, icon: Dumbbell, href: "/dashboard/programs" },
          { label: "This week", value: "—", icon: Calendar, href: "/dashboard/schedule" },
          { label: "Pending import", value: "—", icon: Upload, href: "/dashboard/import" },
        ].map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all group"
          >
            <div className="flex items-center justify-between mb-3">
              <stat.icon className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
              <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* Quick actions for new orgs */}
      {isNew && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Get started in 3 steps</h2>
          <div className="space-y-3">
            {[
              { step: 1, label: "Add a facility", desc: "Add your rec centre, pool, or arena", href: "/dashboard/facilities/new" },
              { step: 2, label: "Create a program", desc: "Add Lap Swim, Drop-in Hockey, or any activity", href: "/dashboard/programs/new" },
              { step: 3, label: "Build your schedule", desc: "Set recurring session times for each program", href: "/dashboard/schedule" },
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
    </div>
  );
}
