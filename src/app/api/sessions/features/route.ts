import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";

/**
 * Hex, the same convention as `session_templates.color`. Validated here rather
 * than by a CHECK constraint for the same reason `link_url` is (migration 028,
 * decision 4): a bad value should be a 400 with a message, not a constraint
 * violation surfacing as a 500.
 */
const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, e.g. #B4472A");

const HttpUrl = z
  .string()
  .url()
  .refine((v) => /^https?:\/\//i.test(v), "Links must start with http:// or https://");

/**
 * Empty strings from a form mean "cleared", not "the empty string". Every text
 * field normalizes "" → null so a cleared field reads back as absent and the
 * `?? fallback` chains in `eventDisplayTitle` and `eventAccentColor` actually
 * fire — otherwise clearing a title yields a blank event name rather than the
 * schedule group's.
 */
const blankToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable());

const FeatureSchema = z.object({
  session_id: z.string().uuid(),
  is_event: z.boolean(),
  in_brochure: z.boolean(),
  title: blankToNull(z.string().max(120)).optional().default(null),
  summary: blankToNull(z.string().max(200)).optional().default(null),
  description: blankToNull(z.string().max(4000)).optional().default(null),
  image_url: blankToNull(HttpUrl).optional().default(null),
  link_url: blankToNull(HttpUrl).optional().default(null),
  link_label: blankToNull(z.string().max(60)).optional().default(null),
  event_category: blankToNull(z.string().max(60)).optional().default(null),
  accent_color: blankToNull(HexColor).optional().default(null),
});

/**
 * POST /api/sessions/features — set a session's event/brochure flags and the
 * copy behind them.
 *
 * One endpoint for both because they are one edit: staff tick "show on the
 * event calendar" and write the blurb in the same breath, and splitting the
 * write would let a session be flagged with no copy (a blank calendar cell) if
 * the second call failed.
 *
 * The flags live on `sessions` and the copy in `session_features`, so this
 * writes two tables. The order matters on the way in — the feature row is
 * upserted first, so a session is never flagged as an event before the content
 * the calendar reads exists.
 *
 * Turning both flags off deliberately does NOT delete the feature row. See
 * decision 3 in migration 028: staff who un-feature an event in March and
 * re-feature it in October must get their description and image back.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = FeatureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { session_id, is_event, in_brochure, ...content } = parsed.data;

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  // RLS would already stop a cross-org write, but an explicit check turns what
  // would otherwise be a silent zero-row update into a 404.
  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", session_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { error: featureError } = await supabase
    .from("session_features")
    .upsert(
      { session_id, org_id: membership.org_id, ...content, updated_at: new Date().toISOString() },
      // session_id is UNIQUE (one feature record per session), so it — not the
      // synthetic id — is what a repeat save has to collide on.
      { onConflict: "session_id" }
    );

  if (featureError) {
    console.error("session feature upsert error:", featureError);
    return NextResponse.json({ error: "Failed to save event details." }, { status: 500 });
  }

  const { error: flagsError } = await supabase
    .from("sessions")
    .update({ is_event, in_brochure })
    .eq("id", session_id)
    .eq("org_id", membership.org_id);

  if (flagsError) {
    console.error("session flags update error:", flagsError);
    return NextResponse.json({ error: "Failed to update the session." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
