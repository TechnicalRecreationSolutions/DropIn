import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CreateSeasonSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(2000).nullish(),
    starts_on: z.string().regex(ISO_DATE),
    ends_on: z.string().regex(ISO_DATE),
    status: z.enum(["planning", "active", "archived"]).optional(),
  })
  // Mirrors the seasons_dates_ordered CHECK constraint so the caller gets a
  // 400 with a usable message instead of a 500 from a constraint violation.
  .refine((v) => v.ends_on >= v.starts_on, {
    message: "The end date must be on or after the start date.",
    path: ["ends_on"],
  });

/**
 * GET  /api/seasons — every season for the caller's org, newest period first.
 * POST /api/seasons — create one (owner/admin only, matching the RLS policy in 027).
 */
export async function GET() {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data, error }, { data: assigned }] = await Promise.all([
    supabase
      .from("seasons")
      .select("*")
      .eq("org_id", membership.org_id)
      .order("starts_on", { ascending: false }),
    // How many sessions each season holds. Counted here rather than by a
    // grouped query because PostgREST has no GROUP BY, and rather than a
    // count-per-season round trip because that is N requests for a list that
    // is typically under ten rows. Only the id column crosses the wire, and
    // only for sessions that are actually assigned.
    supabase
      .from("sessions")
      .select("season_id")
      .eq("org_id", membership.org_id)
      .eq("is_active", true)
      .not("season_id", "is", null),
  ]);

  if (error) return NextResponse.json({ error: "Could not load seasons" }, { status: 500 });

  const counts = new Map<string, number>();
  for (const row of assigned ?? []) {
    if (row.season_id) counts.set(row.season_id, (counts.get(row.season_id) ?? 0) + 1);
  }

  return NextResponse.json({
    seasons: (data ?? []).map((season) => ({
      ...season,
      session_count: counts.get(season.id) ?? 0,
    })),
  });
}

export async function POST(request: Request) {
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

  const parsed = CreateSeasonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid input",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("seasons")
    .insert({
      org_id: membership.org_id,
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      description: parsed.data.description ?? null,
      starts_on: parsed.data.starts_on,
      ends_on: parsed.data.ends_on,
      status: parsed.data.status ?? "planning",
    })
    .select("*")
    .single();

  if (error || !data) {
    // 23505 is the (org_id, slug) unique violation — two seasons named the
    // same thing slugify to the same value.
    return NextResponse.json(
      {
        error:
          error?.code === "23505"
            ? "You already have a season with this name."
            : "Could not create season",
      },
      { status: error?.code === "23505" ? 409 : 500 }
    );
  }

  return NextResponse.json({ season: data }, { status: 201 });
}
