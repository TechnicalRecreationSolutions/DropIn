import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import ScrapingClient from "./ScrapingClient";

export default async function ScrapingPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const db = supabase as any;

  const [{ data: configs }, { data: facilities }, { data: jobs }] = await Promise.all([
    db
      .from("scraping_configs")
      .select("*")
      .eq("org_id", orgContext.org.id)
      .order("created_at", { ascending: false }),
    db
      .from("facilities")
      .select("id, name")
      .eq("org_id", orgContext.org.id)
      .order("name", { ascending: true }),
    db
      .from("scraping_jobs")
      .select("*")
      .eq("org_id", orgContext.org.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Scraping</h1>
        <p className="text-gray-500 mt-1">
          Automatically sync your schedule from your existing Xplor, ActiveNet, or NextRec page —
          no manual re-entry required.
        </p>
      </div>
      <ScrapingClient
        initialConfigs={configs ?? []}
        facilities={facilities ?? []}
        initialJobs={jobs ?? []}
      />
    </div>
  );
}
