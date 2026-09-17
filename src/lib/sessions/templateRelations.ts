import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type Client = SupabaseClient<Database>;

/** Max registration links on one template — see migration 050's header. */
export const MAX_TEMPLATE_LINKS = 3;

/**
 * A registration link as the template routes accept it.
 *
 * `label` is required and trimmed to non-empty on purpose: the modal renders
 * the label and never the URL, so a blank one would produce a button with no
 * text on a public page.
 */
export const TemplateLinkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z
    .string()
    .trim()
    .url()
    // `z.string().url()` alone accepts `javascript:alert(1)` and `data:` URLs —
    // it checks parseability, not scheme. This value is written straight into
    // an href on a public page, so the scheme allowlist is the part that stops
    // a stored XSS, and it is asserted again by a CHECK constraint in the
    // database for any writer that does not come through here.
    .refine(
      (value) => /^https?:\/\//i.test(value),
      "Links must start with http:// or https://"
    )
    .refine((value) => value.length <= 2048, "Link is too long"),
});

export const TemplateLinksSchema = z.array(TemplateLinkSchema).max(MAX_TEMPLATE_LINKS);

export type TemplateLinkInput = z.infer<typeof TemplateLinkSchema>;

/**
 * Replaces a template's tag assignments.
 *
 * Every tag must belong to the same facility as the template. That check is the
 * point of a facility-scoped vocabulary: without it one pool's "Women's Only"
 * could be attached to another building's schedule and appear in a legend that
 * never defined it.
 *
 * Delete-then-insert rather than a diff. The set is at most a handful of rows,
 * the ordering is positional (display_order is the array index), and a diff
 * would have to reason about reordering anyway — this cannot leave a stale
 * order behind.
 *
 * Returns an error message for the caller to surface, or null on success.
 */
export async function replaceTemplateTags(
  supabase: Client,
  {
    templateId,
    orgId,
    facilityId,
    tagIds,
  }: { templateId: string; orgId: string; facilityId: string; tagIds: string[] }
): Promise<string | null> {
  if (tagIds.length > 0) {
    const unique = [...new Set(tagIds)];
    const { data: validTags } = await supabase
      .from("tags")
      .select("id")
      .in("id", unique)
      .eq("facility_id", facilityId)
      .eq("org_id", orgId);

    if ((validTags?.length ?? 0) !== unique.length) {
      return "One or more tags not found at this facility";
    }
  }

  const { error: deleteError } = await supabase
    .from("session_template_tags")
    .delete()
    .eq("session_template_id", templateId);

  if (deleteError) return "Could not update tags on this template.";

  if (tagIds.length === 0) return null;

  const { error: insertError } = await supabase.from("session_template_tags").insert(
    [...new Set(tagIds)].map((tag_id, index) => ({
      session_template_id: templateId,
      tag_id,
      org_id: orgId,
      // Positional: the order staff arranged them in is the order they render,
      // and therefore which two survive the truncation on a card.
      display_order: index,
    }))
  );

  if (insertError) return "Could not attach tags to this template.";
  return null;
}

/**
 * Replaces a template's registration links.
 *
 * Same delete-then-insert reasoning as the tags above, and the same positional
 * ordering — here it also keeps display_order inside the 0..2 the database
 * CHECKs, which is what enforces the cap of three.
 */
export async function replaceTemplateLinks(
  supabase: Client,
  {
    templateId,
    orgId,
    links,
  }: { templateId: string; orgId: string; links: TemplateLinkInput[] }
): Promise<string | null> {
  const { error: deleteError } = await supabase
    .from("session_template_links")
    .delete()
    .eq("session_template_id", templateId);

  if (deleteError) return "Could not update links on this template.";

  if (links.length === 0) return null;

  const { error: insertError } = await supabase.from("session_template_links").insert(
    links.slice(0, MAX_TEMPLATE_LINKS).map((link, index) => ({
      session_template_id: templateId,
      org_id: orgId,
      label: link.label,
      url: link.url,
      display_order: index,
    }))
  );

  if (insertError) return "Could not attach links to this template.";
  return null;
}
