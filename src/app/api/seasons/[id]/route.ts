import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const UpdateSeasonSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(2000).nullish(),
  starts_on: z.string().regex(ISO_DATE).optional(),
  ends_on: z.string().regex(ISO_DATE).optional(),
  status: z.enum(["planning", "active", "archived"]).optional(),
});

/**
 * PATCH  /api/seasons/[id] — rename, re-date, or change the status of a season.
 * DELETE /api/seasons/[id] — remove it. Sessions assigned to it are NOT deleted;
 *                            their season_id is set to NULL (see migration 027).
 *
 * Both are owner/admin only, matching seasons_managers_crud.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only org owners and admins can manage seasons" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateSeasonSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // A PATCH may move only one end of the range, so the ordering rule has to be
  // checked against the merged result rather than the payload alone —
  // otherwise moving starts_on past an untouched ends_on reaches the DB and
  // comes back as a raw constraint violation.
  const { data: existing } = await supabase
    .from("seasons")
    .select("starts_on, ends_on")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Season not found" }, { status: 404 });

  const startsOn = parsed.data.starts_on ?? existing.starts_on;
  const endsOn = parsed.data.ends_on ?? existing.ends_on;
  if (endsOn < startsOn) {
    return NextResponse.json(
      { error: "The end date must be on or after the start date." },
      { status: 400 }
    );
  }

  const payload = {
    ...parsed.data,
    ...(parsed.data.name ? { slug: slugify(parsed.data.name) } : {}),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("seasons")
    .update(payload)
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "You already have a season with this name."
            : "Could not update season.",
      },
      { status: error.code === "23505" ? 409 : 500 }
    );
  }
  if (!data) return NextResponse.json({ error: "Season not found" }, { status: 404 });

  return NextResponse.json({ season: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only org owners and admins can manage seasons" },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from("seasons")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not delete season" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
