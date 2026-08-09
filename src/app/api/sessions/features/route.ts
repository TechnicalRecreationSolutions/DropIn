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
 *
 * Note the deliberate three-way distinction, which the partial semantics below
 * depend on: **absent** means "don't touch this", **null** (or "") means
 * "clear it", and a value means "set it".
 */
const blankToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable());

/**
 * A PATCH, not a PUT — every field is optional and an omitted field is left
 * alone.
 *
 * This matters more than it looks. The one-click "add to event calendar" action
 * sends nothing but `session_id` and `is_event`; if omitted content defaulted to
 * null, that single click would silently erase the title, blurb, image and link
 * an org had written — the exact loss migration 028 decision 3 exists to
 * prevent, delivered by the feature meant to be the safe shortcut.
 */
const FeatureSchema = z.object({
  session_id: z.string().uuid(),
  is_event: z.boolean().optional(),
  in_brochure: z.boolean().optional(),
  title: blankToNull(z.string().max(120)).optional(),
  summary: blankToNull(z.string().max(200)).optional(),
  description: blankToNull(z.string().max(4000)).optional(),
  image_url: blankToNull(HttpUrl).optional(),
  link_url: blankToNull(HttpUrl).optional(),
  link_label: blankToNull(z.string().max(60)).optional(),
  event_category: blankToNull(z.string().max(60)).optional(),
  accent_color: blankToNull(HexColor).optional(),
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

  // Only the keys the caller actually sent. `undefined` means "leave alone";
  // an explicit null in the payload survives this filter and clears the column.
  const contentUpdates = Object.fromEntries(
    Object.entries(content).filter(([, value]) => value !== undefined)
  );
  const flagUpdates = {
    ...(is_event === undefined ? {} : { is_event }),
    ...(in_brochure === undefined ? {} : { in_brochure }),
  };

  if (Object.keys(contentUpdates).length === 0 && Object.keys(flagUpdates).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update — send at least one flag or content field" },
      { status: 400 }
    );
  }

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

  if (Object.keys(contentUpdates).length > 0) {
    const { error: featureError } = await supabase.from("session_features").upsert(
      {
        session_id,
        org_id: membership.org_id,
        ...contentUpdates,
        updated_at: new Date().toISOString(),
      },
      // session_id is UNIQUE (one feature record per session), so it — not the
      // synthetic id — is what a repeat save has to collide on. On conflict the
      // SET list is built from the keys present in this payload, which is what
      // makes an omitted column keep its stored value rather than being nulled.
      { onConflict: "session_id" }
    );

    if (featureError) {
      console.error("session feature upsert error:", featureError);
      return NextResponse.json({ error: "Failed to save event details." }, { status: 500 });
    }
  }

  // Both branches return the stored flags, so a caller that sent only one — the
  // one-click action — can render the result without guessing at the other. A
  // content-only save reads rather than writes: touching `sessions` to learn
  // something it isn't changing would bump the row for no reason.
  const flagQuery =
    Object.keys(flagUpdates).length > 0
      ? supabase.from("sessions").update(flagUpdates).eq("id", session_id).eq("org_id", membership.org_id)
      : supabase.from("sessions").select("is_event, in_brochure").eq("id", session_id).eq("org_id", membership.org_id);

  const { data: updated, error: flagsError } = await flagQuery
    .select("is_event, in_brochure")
    .single();

  if (flagsError) {
    console.error("session flags update error:", flagsError);
    return NextResponse.json({ error: "Failed to update the session." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    isEvent: updated.is_event,
    inBrochure: updated.in_brochure,
  });
}
