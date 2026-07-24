import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/scraping/jobs/[id] — job status + its conflicts.
 * Polled by the dashboard while a job is "running".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string } | null };

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const db = supabase as any;

  const { data: job } = await db
    .from("scraping_jobs")
    .select("*")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { data: conflicts } = await db
    .from("scraping_conflicts")
    .select("*")
    .eq("job_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ job, conflicts: conflicts ?? [] });
}
