import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const UpdateConfigSchema = z.object({
  source_url: z.string().url().optional(),
  platform: z.enum(["xplor", "activenet", "nextrec", "generic"]).optional(),
  schedule_cron: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  facility_id: z.string().uuid().nullish(),
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
 * PATCH /api/scraping/configs/[id] — update a scraping config (e.g. deactivate).
 * DELETE /api/scraping/configs/[id] — remove a scraping config.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const parsed = UpdateConfigSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { data, error } = await (supabase as any)
    .from("scraping_configs")
    .update(parsed.data)
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not update scraping config" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Scraping config not found" }, { status: 404 });

  return NextResponse.json({ config: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage scraping" }, { status: 403 });
  }

  const { error } = await (supabase as any)
    .from("scraping_configs")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not delete scraping config" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
