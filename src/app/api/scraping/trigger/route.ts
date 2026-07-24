import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TriggerRequestSchema } from "@/lib/scraping/schemas";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dropin.app";

/**
 * POST /api/scraping/trigger
 *
 * Starts a manual scraping run for a config. Inserts a "running" job row,
 * then fires the scrape off to the external scraper service (or the
 * dev-only mock in SCRAPING_MOCK_MODE) without waiting for it to finish —
 * the scraper reports back asynchronously via /api/scraping/webhook.
 *
 * Ownership of the config is verified with the user-scoped client (RLS).
 * scraping_jobs writes use the admin client — per migration 006, RLS only
 * grants members SELECT on scraping_jobs; INSERT/UPDATE is admin-only by
 * design, matching the Stripe webhook's write pattern.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const adminDb = admin as any;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string; role: string } | null };

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can trigger scraping" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = TriggerRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid config_id" }, { status: 400 });

  const db = supabase as any;

  const { data: config } = await db
    .from("scraping_configs")
    .select("id, org_id, source_url, platform")
    .eq("id", parsed.data.config_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!config) return NextResponse.json({ error: "Scraping config not found" }, { status: 404 });

  const { data: job, error: jobError } = await adminDb
    .from("scraping_jobs")
    .insert({
      config_id: config.id,
      org_id: membership.org_id,
      status: "running",
      triggered_by: "manual",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("Could not insert scraping_jobs row:", jobError?.message);
    return NextResponse.json({ error: "Could not start scraping job" }, { status: 500 });
  }

  const secret = process.env.SCRAPER_SERVICE_SECRET;
  const callbackUrl = `${APP_URL}/api/scraping/webhook`;
  const scraperUrl = process.env.SCRAPING_MOCK_MODE === "true"
    ? `${APP_URL}/api/scraping/mock-scraper`
    : process.env.SCRAPER_SERVICE_URL;

  if (!scraperUrl || !secret) {
    await adminDb
      .from("scraping_jobs")
      .update({
        status: "failed",
        error_message: "Scraping service is not configured",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json({ error: "Scraping service is not configured" }, { status: 500 });
  }

  try {
    // Fire-and-forget: the scraper replies asynchronously via the webhook.
    void fetch(scraperUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: job.id,
        source_url: config.source_url,
        platform: config.platform,
        callback_url: callbackUrl,
        callback_secret: secret,
      }),
    }).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      await adminDb
        .from("scraping_jobs")
        .update({ status: "failed", error_message: `Could not reach scraper: ${message}`, completed_at: new Date().toISOString() })
        .eq("id", job.id);
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await adminDb
      .from("scraping_jobs")
      .update({ status: "failed", error_message: `Could not reach scraper: ${message}`, completed_at: new Date().toISOString() })
      .eq("id", job.id);

    return NextResponse.json({ error: "Could not reach scraping service" }, { status: 502 });
  }

  return NextResponse.json({ job_id: job.id });
}
