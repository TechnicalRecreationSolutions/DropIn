import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus, Dumbbell, Eye, EyeOff } from "lucide-react";
import { getSportCategory } from "@/lib/utils/sport-categories";

export default async function ProgramsPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  type ProgramRow = {
    id: string; name: string; sport_category: string; cost_cents: number;
    is_published: boolean; facilities: { name: string } | null;
    sessions: { id: string }[];
  };
  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: programs } = await supabase
    .from("programs")
    .select("id, name, sport_category, cost_cents, is_published, facilities(name), sessions(id)")
    .eq("org_id", orgContext.org.id)
    .order("created_at", { ascending: false }) as unknown as { data: ProgramRow[] | null };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Programs</h1>
          <p className="text-gray-500 mt-1">Activities and drop-in sessions your organization offers.</p>
        </div>
        <Link
          href="/dashboard/programs/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add program
        </Link>
      </div>

      {!programs || programs.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Dumbbell className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">No programs yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Add your first program to start building your schedule.
          </p>
          <Link
            href="/dashboard/programs/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add your first program
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {programs.map((program) => {
            const sport = getSportCategory(program.sport_category);
            const facility = program.facilities;
            const sessionCount = program.sessions?.length ?? 0;

            return (
              <Link
                key={program.id}
                href={`/dashboard/programs/${program.id}`}
                className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 text-xl">
                  {sport ? "🏃" : "🎯"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{program.name}</p>
                  <p className="text-sm text-gray-500 truncate">
                    {facility?.name ?? "—"} · {sessionCount} session{sessionCount !== 1 ? "s" : ""} · {sport?.label ?? program.sport_category}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {program.cost_cents === 0 ? (
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Free</span>
                  ) : (
                    <span className="text-xs text-gray-700 bg-gray-100 px-2 py-1 rounded-full">
                      ${(program.cost_cents / 100).toFixed(2)}
                    </span>
                  )}
                  {program.is_published ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                      <Eye className="w-3 h-3" /> Published
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                      <EyeOff className="w-3 h-3" /> Draft
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
