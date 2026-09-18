import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";

const CreateTagSchema = z.object({
  facility_id: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

/**
 * GET  /api/tags?facilityId=... — the facility's tag vocabulary.
 * POST /api/tags               — add one word to it.
 *
 * Staff-only, both. The public never calls this: a visitor gets tags already
 * attached to their sessions through /api/sessions/expand, which is the only
 * shape a schedule view needs them in. There is deliberately no public list
 * endpoint — a facility's full vocabulary includes tags used on nothing.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId");

  let query = supabase
    .from("tags")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("display_order", { ascending: true })
    .order("label", { ascending: true });

  if (facilityId) query = query.eq("facility_id", facilityId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load tags" }, { status: 500 });
  return NextResponse.json({ tags: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Coordinators may CREATE a tag — they are the ones labelling sessions, and
  // a tag is additive. Renaming or deleting one is "tag:manage" and stays with
  // managers, because it rewrites every schedule already using it.
  const denied = requirePermission(membership, "tag:create");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateTagSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { data: facility } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", parsed.data.facility_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("tags")
    .insert({
      org_id: membership.org_id,
      facility_id: parsed.data.facility_id,
      label: parsed.data.label,
      color: parsed.data.color,
    })
    .select("*")
    .single();

  if (error) {
    // 23505 is the case this whole table exists to produce: someone is adding
    // a word the facility already has, in different capitalisation. Say so,
    // rather than reporting a server error for a vocabulary working correctly.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This facility already has a tag with that name." },
        { status: 409 }
      );
    }
    console.error("POST /api/tags failed:", error);
    return NextResponse.json({ error: "Could not create tag." }, { status: 500 });
  }

  return NextResponse.json({ tag: data }, { status: 201 });
}
