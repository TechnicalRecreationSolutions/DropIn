import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import ConflictReviewList from "@/components/scraping/ConflictReviewList";

export default async function ScrapingJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const db = supabase as any;

  const { data: job } = await db
    .from("scraping_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("org_id", orgContext.org.id)
    .maybeSingle();

  if (!job) notFound();

  const { data: conflicts } = await db
    .from("scraping_conflicts")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Scraping run</h1>
        <p className="text-gray-500 mt-1">
          Started {new Date(job.created_at).toLocaleString()} · Status: {job.status}
        </p>
      </div>
      <ConflictReviewList job={job} initialConflicts={conflicts ?? []} />
    </div>
  );
}
