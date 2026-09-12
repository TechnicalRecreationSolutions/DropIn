import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

const UpdateConfigurationSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  display_order: z.number().int().min(0).optional(),
});

/**
 * PATCH /api/facility-configurations/[id] — rename or reorder.
 * DELETE /api/facility-configurations/[id] — remove it.
 *
 * Deleting does NOT delete the lanes assigned to it: the FK is
 * ON DELETE SET NULL (migration 048), so every space it held comes back as
 * "in every configuration", which is where they all started. Sessions attached
 * to those spaces keep running untouched — deleting a configuration is
 * relabelling the building, not demolishing part of it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only org owners and admins can manage configurations" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateConfigurationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { data, error } = await supabase
    .from("facility_configurations")
    .update({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.display_order !== undefined
        ? { display_order: parsed.data.display_order }
        : {}),
      // This schema has no updated_at trigger — every route that cares sets it
      // explicitly (see /api/sessions and session_internal).
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "This facility already has a configuration with that name."
            : "Could not update configuration.",
      },
      { status: 500 }
    );
  }
  if (!data) return NextResponse.json({ error: "Configuration not found" }, { status: 404 });

  return NextResponse.json({ configuration: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only org owners and admins can manage configurations" },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from("facility_configurations")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not delete configuration" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
