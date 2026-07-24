import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { headers } from "next/headers";
import crypto from "crypto";

export const runtime = "nodejs";

const TrackSchema = z.object({
  event: z.string().max(64),
  orgId: z.string().uuid(),
  facilityId: z.string().uuid().nullable().optional(),
  referrer: z.string().url().nullable().optional(),
  pathname: z.string().max(1024).nullable().optional(),
});

/**
 * POST /api/analytics/track
 *
 * Public endpoint — called by the embed script (widget.js) on widget load.
 * Stores only hashed IPs (SHA-256 of ip+daily_salt) — no raw PII.
 * Rate limiting is handled at the edge via Vercel middleware or upstash.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = TrackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { event, orgId, facilityId, referrer, pathname } = parsed.data;

  // Hash IP with a daily salt — never store raw IPs
  const headersList = await headers();
  const rawIp =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    "unknown";

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dailySalt = process.env.ANALYTICS_IP_SALT ?? "dropin-default-salt";
  const ipHash = crypto
    .createHash("sha256")
    .update(rawIp + today + dailySalt)
    .digest("hex");

  // Validate event_type against the DB CHECK constraint values
  const allowedEvents = ["widget_view", "program_click", "facility_view", "schedule_view"];
  if (!allowedEvents.includes(event)) {
    return NextResponse.json({ error: "Unknown event type" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    await (admin as any).from("analytics_events").insert({
      event_type: event,
      org_id: orgId,
      facility_id: facilityId ?? null,
      ip_hash: ipHash,
      referrer_url: referrer ?? null,
      // user_agent from request headers — stored for device-type aggregation only
      user_agent: headersList.get("user-agent")?.slice(0, 512) ?? null,
    });
  } catch {
    // Silently swallow — tracking must never break the consumer experience
  }

  return NextResponse.json({ ok: true });
}
