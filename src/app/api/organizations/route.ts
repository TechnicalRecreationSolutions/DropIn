import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORG_MEDIA_BUCKET } from "@/lib/storage/orgMedia";

/**
 * Every second path segment the bucket uses (migration 030). Listed rather
 * than discovered: Storage has no recursive list, so a folder not named here
 * is a folder never swept, and the constant sits beside the type it mirrors.
 */
const ORG_MEDIA_KINDS = ["facilities", "schedules", "org"] as const;

/** Storage's `list` default is 100; asking for more per call costs nothing. */
const STORAGE_PAGE = 100;

/**
 * The typed organization name. Checked here for the message and again inside
 * `delete_organization()`, which is the control.
 */
const DeleteOrgSchema = z.object({
  confirmName: z.string().min(1),
});

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
  /**
   * May aux staff post public facility notices? (migration 060)
   *
   * A policy switch rather than a profile field, and the only thing in this
   * schema that changes what someone else is allowed to do. Gated by the same
   * `org:edit-settings` permission as the rest — the people who can rename the
   * organization are the people who decide how far it trusts its guards.
   */
  aux_can_post_notices: z.boolean().optional(),
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
 * **`slug` is not editable.** It is a stable identifier baked into whatever
 * has already referenced this org. Changing it needs a redirect story first,
 * which is a feature in its own right.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requirePermission(membership, "org:edit-settings");
  if (denied) return denied;

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

/**
 * DELETE /api/organizations — delete the caller's own organization.
 *
 * No id in the path, for the same reason PATCH has none: the org being acted
 * on is always the caller's own, derived server-side, never taken from a value
 * the client chose. Deriving it from the request body would mean the one
 * irreversible action in the product read its target from the internet.
 *
 * The confirmation name arrives in the body and is checked TWICE — once here
 * so the caller gets a specific message with the expected name in it, and once
 * inside `delete_organization()` (migration 062), which is the control. This
 * route could be skipped entirely by calling the RPC directly with the
 * publishable key; the function refuses there just the same.
 *
 * ## Order of operations
 *
 * Database first, storage second, and never the reverse. Storage is not
 * transactional with Postgres, so one of them lands first no matter what:
 *
 *   - Row first, images orphaned  → wasted bytes in a bucket nobody links to.
 *   - Images first, row survives  → an organization still serving public pages
 *                                   with every logo and photo 404ing.
 *
 * The first failure mode is a cleanup job. The second is a visibly broken
 * public site for a customer who asked to leave, so the storage sweep is
 * best-effort and its failure is reported without failing the request.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requirePermission(membership, "org:delete");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = DeleteOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Type the organization's name to confirm." }, { status: 400 });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", membership.org_id)
    .maybeSingle();

  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  if (parsed.data.confirmName.trim() !== org.name.trim()) {
    return NextResponse.json(
      { error: `Type the organization's name exactly — "${org.name}" — to confirm.` },
      { status: 400 }
    );
  }

  const { error } = await supabase.rpc("delete_organization", {
    p_org_id: membership.org_id,
    p_confirm_name: parsed.data.confirmName,
  });

  if (error) {
    // The function's messages are already written to be read by a person
    // ("Cancel the subscription in Billing before…"), so they are passed
    // through rather than flattened into a generic failure.
    return NextResponse.json(
      { error: error.message || "Could not delete the organization." },
      { status: 400 }
    );
  }

  const storageError = await removeOrgMedia(membership.org_id);

  return NextResponse.json({ ok: true, storageError });
}

/**
 * Removes everything under `{orgId}/` in the org-media bucket.
 *
 * Service-role, because the RLS policies in migration 030 grant writes to
 * members of the org — and by the time this runs the memberships are already
 * gone, so the caller's own client would be refused on every object.
 *
 * Returns a message on failure rather than throwing: the organization is
 * already deleted at this point and there is nothing useful to roll back to.
 * A listing caps at 100 entries per call by default, so each folder is paged
 * until it comes back short — the `.limit(1000)` shortcut returns a silent
 * truncation, which here would mean quietly leaving images behind.
 */
async function removeOrgMedia(orgId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const paths: string[] = [];

    for (const kind of ORG_MEDIA_KINDS) {
      const prefix = `${orgId}/${kind}`;
      for (let offset = 0; ; offset += STORAGE_PAGE) {
        const { data, error } = await admin.storage
          .from(ORG_MEDIA_BUCKET)
          .list(prefix, { limit: STORAGE_PAGE, offset });

        if (error) return error.message;
        if (!data || data.length === 0) break;
        paths.push(...data.map((f) => `${prefix}/${f.name}`));
        if (data.length < STORAGE_PAGE) break;
      }
    }

    if (paths.length === 0) return null;

    const { error } = await admin.storage.from(ORG_MEDIA_BUCKET).remove(paths);
    return error ? error.message : null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not remove uploaded images.";
  }
}
