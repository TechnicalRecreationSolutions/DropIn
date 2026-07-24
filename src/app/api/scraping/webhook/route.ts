import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySignature } from "@/lib/scraping/hmac";
import { diffScrapedData } from "@/lib/scraping/diff";
import { ScrapingWebhookPayloadSchema } from "@/lib/scraping/schemas";

export const runtime = "nodejs";

// Raw body is required for HMAC signature verification — no body parsing middleware
export const dynamic = "force-dynamic";

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * POST /api/scraping/webhook
 *
 * Receives scrape results from the external scraper service.
 *
 * Security:
 * - Caller is untrusted (no Supabase session) — HMAC signature over the raw
 *   body is the entire auth boundary and is verified before any parsing.
 * - The payload's timestamp is checked for staleness (replay protection).
 * - scraping_jobs.id doubles as the idempotency key — one job row per
 *   expected delivery, so a completed/failed job is never reprocessed.
 * - org_id/facility_id/is_published/is_active are never trusted from the
 *   payload — they're derived from the job's own config row.
 */
export async function POST(request: Request) {
  const signatureHeader = request.headers.get("x-scraper-signature");

  const secret = process.env.SCRAPER_SERVICE_SECRET;
  if (!secret) {
    console.error("SCRAPER_SERVICE_SECRET is not set");
    return NextResponse.json({ error: "Scraping webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();

  if (!verifySignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ScrapingWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const payload = parsed.data;

  const payloadAge = Date.now() - new Date(payload.timestamp).getTime();
  if (!Number.isFinite(payloadAge) || payloadAge > REPLAY_WINDOW_MS || payloadAge < -REPLAY_WINDOW_MS) {
    return NextResponse.json({ error: "Payload timestamp outside acceptable window" }, { status: 400 });
  }

  const admin = createAdminClient();
  const db = admin as any;

  const { data: job } = await db
    .from("scraping_jobs")
    .select("id, org_id, status, config_id")
    .eq("id", payload.job_id)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ error: "Unknown job_id" }, { status: 400 });
  }

  if (job.status === "completed" || job.status === "failed") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (payload.status === "failed") {
    await db
      .from("scraping_jobs")
      .update({
        status: "failed",
        error_message: payload.error_message ?? "Scraper reported failure",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return NextResponse.json({ ok: true });
  }

  try {
    const [{ data: currentPrograms }, { data: currentSessions }] = await Promise.all([
      db.from("programs").select("*").eq("org_id", job.org_id),
      db.from("sessions").select("*").eq("org_id", job.org_id),
    ]);

    const conflicts = diffScrapedData({
      jobId: job.id,
      orgId: job.org_id,
      scrapedPrograms: payload.programs,
      scrapedSessions: payload.sessions,
      currentPrograms: currentPrograms ?? [],
      currentSessions: currentSessions ?? [],
    });

    if (conflicts.length > 0) {
      const { error: insertError } = await db.from("scraping_conflicts").insert(conflicts);
      if (insertError) throw insertError;
    }

    await db
      .from("scraping_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        programs_found: payload.programs.length,
        sessions_found: payload.sessions.length,
        conflicts_count: conflicts.length,
        raw_data: payload as unknown as Record<string, unknown>,
      })
      .eq("id", job.id);

    await db
      .from("scraping_configs")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", job.config_id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Failed to process scraping job ${job.id}:`, message);
    // Don't return 500 — avoid the caller retrying into a partial-write loop.
    // error_message left set (job stays "running") so it surfaces as stuck in the UI.
    await db
      .from("scraping_jobs")
      .update({ error_message: `Processing failed: ${message}` })
      .eq("id", job.id);
  }

  return NextResponse.json({ ok: true });
}
