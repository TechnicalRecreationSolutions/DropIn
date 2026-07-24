import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CreateConfigSchema = z.object({
  facility_id: z.string().uuid().nullish(),
  source_url: z.string().url(),
  platform: z.enum(["xplor", "activenet", "nextrec", "generic"]),
  schedule_cron: z.string().min(1).optional(),
});

async function getMembership(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string; role: string } | null };

  return membership;
}

/**
 * GET /api/scraping/configs — list the org's scraping configs.
 * POST /api/scraping/configs — create a new scraping config.
 */
export async function GET() {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await (supabase as any)
    .from("scraping_configs")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Could not load scraping configs" }, { status: 500 });
  return NextResponse.json({ configs: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage scraping" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateConfigSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { data, error } = await (supabase as any)
    .from("scraping_configs")
    .insert({
      org_id: membership.org_id,
      facility_id: parsed.data.facility_id ?? null,
      source_url: parsed.data.source_url,
      platform: parsed.data.platform,
      schedule_cron: parsed.data.schedule_cron ?? "0 3 * * *",
      is_active: true,
    })
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ error: "Could not create scraping config" }, { status: 500 });
  return NextResponse.json({ config: data }, { status: 201 });
}
