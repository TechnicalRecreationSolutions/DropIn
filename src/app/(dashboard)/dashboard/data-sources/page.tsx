import Link from "next/link";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Upload, ArrowRight } from "lucide-react";

type ImportedScheduleGroupRow = {
  id: string;
  name: string;
  created_at: string;
  facilities: { name: string } | null;
};

export default async function DataSourcesPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: recentImports } = (await db
    .from("schedule_groups")
    .select("id, name, created_at, facilities(name)")
    .eq("org_id", orgContext.org.id)
    .eq("source", "imported")
    .order("created_at", { ascending: false })
    .limit(20)) as { data: ImportedScheduleGroupRow[] | null };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Data Sources</h1>
        <p className="text-gray-500 mt-1">
          Cross-org history for everything imported into Dropin. To add new data, navigate
          to the facility, department, or schedule it belongs to and use &quot;Add data&quot; there.
        </p>
      </div>

      <Link
        href="/dashboard/import"
        className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all group"
      >
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
          <Upload className="w-5 h-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900">Import a spreadsheet</p>
          <p className="text-sm text-gray-500">Org-wide import, pick a facility</p>
        </div>
        <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors" />
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Recent imports</h2>
        {!recentImports || recentImports.length === 0 ? (
          <p className="text-sm text-gray-500">No spreadsheet imports yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentImports.map((sg) => (
              <li key={sg.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{sg.name}</p>
                  <p className="text-xs text-gray-500">
                    {sg.facilities?.name ?? "Unknown facility"} · {new Date(sg.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
