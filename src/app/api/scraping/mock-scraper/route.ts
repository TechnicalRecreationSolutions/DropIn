import { NextResponse } from "next/server";
import { z } from "zod";
import { signPayload } from "@/lib/scraping/hmac";
import { genericAdapter } from "@/lib/scraping/platforms/generic";
import type { ScrapingWebhookPayload } from "@/lib/scraping/schemas";

const MockTriggerSchema = z.object({
  job_id: z.string().uuid(),
  source_url: z.string().url(),
  platform: z.string(),
  callback_url: z.string().url(),
  callback_secret: z.string().min(1),
});

/**
 * POST /api/scraping/mock-scraper — dev-only stand-in for the external
 * scraper service. Plays the scraper's role fully: receives the same trigger
 * payload the real service would, synthesizes fixture data, signs it, and
 * POSTs it to the real webhook — so the HMAC path is exercised for real,
 * not bypassed. Never enabled in production.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = MockTriggerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { job_id, source_url, callback_url, callback_secret } = parsed.data;

  const fixtures = await genericAdapter.parse("", { source_url });

  const payload: ScrapingWebhookPayload = {
    job_id,
    status: "completed",
    timestamp: new Date().toISOString(),
    programs: fixtures.programs,
    sessions: fixtures.sessions,
  };

  const rawBody = JSON.stringify(payload);
  const signature = signPayload(rawBody, callback_secret);

  // Fire-and-forget, same as the real scraper would — the trigger route
  // already returned a response to the client before this resolves.
  void fetch(callback_url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Scraper-Signature": signature },
    body: rawBody,
  }).catch((err: unknown) => {
    console.error("Mock scraper: failed to deliver webhook:", err);
  });

  return NextResponse.json({ ok: true, mocked: true });
}
