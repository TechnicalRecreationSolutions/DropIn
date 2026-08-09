import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";

const BrochureSchema = z.object({
  brochureId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).nullable().optional(),
  season_id: z.string().uuid().nullable().optional(),
  facility_id: z.string().uuid().nullable().optional(),
  cover_image_url: z.string().url().nullable().optional(),
  intro_copy: z.string().max(4000).nullable().optional(),
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour")
    .nullable()
    .optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

/**
 * POST /api/brochures — create or update a brochure.
 *
 * Owner/admin only, checked here as well as in RLS. A brochure carries a slug,
 * a publish state and a public URL, which puts it on the structural side of
 * migration 024's line — the same kind of object as a schedule group. Its
 * *contents* are member-writable; see the sections and entries routes.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BrochureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only org owners and admins can manage brochures" },
      { status: 403 }
    );
  }

  const { brochureId, ...fields } = parsed.data;

  // A season belongs to the caller's own org — the same boundary /api/sessions
  // enforces, since 027 leaves it to the route layer.
  if (fields.season_id) {
    const { data: season } = await supabase
      .from("seasons")
      .select("id")
      .eq("id", fields.season_id)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    if (!season) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  }

  if (fields.facility_id) {
    const { data: facility } = await supabase
      .from("facilities")
      .select("id")
      .eq("id", fields.facility_id)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // published_at records when it first went public and is never rewritten by a
  // later edit — a brochure republished after a typo fix was still published on
  // the original date, and the public page dates it from this.
  const goingLive = fields.status === "published";

  const payload = {
    ...fields,
    org_id: membership.org_id,
    slug: slugify(fields.title),
    ...(goingLive ? { published_at: new Date().toISOString() } : {}),
  };

  if (brochureId) {
    const { data: existing } = await supabase
      .from("brochures")
      .select("published_at")
      .eq("id", brochureId)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Brochure not found" }, { status: 404 });

    if (goingLive && existing.published_at) delete (payload as { published_at?: string }).published_at;

    const { error } = await supabase
      .from("brochures")
      .update(payload)
      .eq("id", brochureId)
      .eq("org_id", membership.org_id);

    if (error) {
      return NextResponse.json(
        {
          error:
            error.code === "23505"
              ? "A brochure with that title already exists."
              : "Failed to update brochure.",
        },
        { status: error.code === "23505" ? 409 : 500 }
      );
    }
    return NextResponse.json({ ok: true, brochureId });
  }

  const { data: created, error } = await supabase
    .from("brochures")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "A brochure with that title already exists."
            : "Failed to create brochure.",
      },
      { status: error.code === "23505" ? 409 : 500 }
    );
  }

  return NextResponse.json({ ok: true, brochureId: created.id });
}

/** DELETE /api/brochures?brochureId=uuid — removes the brochure and everything in it. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const brochureId = new URL(request.url).searchParams.get("brochureId");
  if (!brochureId) return NextResponse.json({ error: "brochureId is required" }, { status: 400 });

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only org owners and admins can delete brochures" },
      { status: 403 }
    );
  }

  // Sections and entries cascade. That is deliberate for a whole-brochure
  // delete — unlike deleting a *section*, which must not take its tombstones
  // with it (migration 031, decision 3), discarding the brochure discards the
  // editorial history that only made sense inside it.
  const { error } = await supabase
    .from("brochures")
    .delete()
    .eq("id", brochureId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to delete brochure." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
