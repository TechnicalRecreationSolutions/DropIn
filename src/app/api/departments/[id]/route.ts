import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";

const UpdateDepartmentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  is_published: z.boolean().optional(),
});

/**
 * PATCH /api/departments/[id] — update a department's name/description/publish state.
 * DELETE /api/departments/[id] — remove a department.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage departments" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateDepartmentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const payload = {
    ...parsed.data,
    ...(parsed.data.name ? { slug: slugify(parsed.data.name) } : {}),
  };

  const { data, error } = await supabase
    .from("departments")
    .update(payload)
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "A department with this name already exists at that facility." : "Could not update department." },
      { status: 500 }
    );
  }
  if (!data) return NextResponse.json({ error: "Department not found" }, { status: 404 });

  return NextResponse.json({ department: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage departments" }, { status: 403 });
  }

  const { error } = await supabase
    .from("departments")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not delete department" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
