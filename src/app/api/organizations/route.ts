import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

/**
 * Every field here is optional so the form can PATCH a subset, but the empty
 * string is coerced to null rather than stored: `logo_url` and `website_url`
 * are read by `OrgImage` and by anchor hrefs, and an empty string is a URL
 * that renders a broken image and a link to the current page. Null is the
 * "not set" the readers already handle.
 *
 * `slug` is absent deliberately — see the PATCH comment.
 */
const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: emptyToNull(z.string().max(2000)),
  logo_url: emptyToNull(z.string().url()),
  website_url: emptyToNull(z.string().url()),
  phone: emptyToNull(z.string().max(50)),
  email: emptyToNull(z.string().email()),
  address_line1: emptyToNull(z.string().max(200)),
  city: emptyToNull(z.string().max(100)),
  province: emptyToNull(z.string().length(2)),
  postal_code: emptyToNull(z.string().max(20)),
});

function emptyToNull<T extends z.ZodType>(schema: T) {
  return z
    .union([schema, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v));
}

/**
 * PATCH /api/organizations — update the caller's own organization profile.
 *
 * No id in the path: an org member has exactly one active org (the earliest
 * membership by `joined_at`, per `getRouteMembership`), and taking an id from
 * the client would mean re-deriving authorization from a value the client
 * chose. The org being edited is always the one the caller belongs to.
 *
 * Owner/admin only, matching the `orgs_admin_update` RLS policy. The policy is
 * the real control — this check exists so a member gets a 403 with an
 * explanation instead of a confusing "0 rows updated" success.
 *
 * **`slug` is not editable.** It is the org's public URL (`/org/[orgSlug]`)
 * and is baked into every widget embed a centre has already pasted into their
 * own website. Renaming the org must not silently 404 those. Changing it needs
 * a redirect story first, which is a feature in its own right.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only org owners and admins can change organization settings." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("organizations")
    .update(parsed.data)
    .eq("id", membership.org_id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not save your settings." }, { status: 500 });
  }
  if (!data) {
    // The UPDATE policy has a USING clause but the row is still readable, so a
    // null here means the write was refused rather than the org missing.
    return NextResponse.json({ error: "Could not save your settings." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
