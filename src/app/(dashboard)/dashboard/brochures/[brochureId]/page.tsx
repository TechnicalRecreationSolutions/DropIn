import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getBrochureCandidates } from "@/lib/brochure/candidates";
import BrochureEditor from "@/components/brochure/BrochureEditor";

interface PageProps {
  params: Promise<{ brochureId: string }>;
}

export const metadata = { title: "Edit brochure" };

/**
 * The brochure editor.
 *
 * Everything is fetched here, server-side, and handed down: a brochure is a
 * bounded thing (tens of entries, a handful of sections) and the editor is
 * useless without all of it, so streaming pieces in would only add states to
 * handle. Mutations post to `/api/brochures/*` and then `router.refresh()`.
 *
 * The candidate rail is computed, not stored — see `lib/brochure/candidates.ts`
 * and the header of migration 031.
 */
export default async function BrochureEditorPage({ params }: PageProps) {
  const { brochureId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) notFound();

  const orgId = orgContext.org.id;
  const supabase = await createClient();

  const { data: brochure } = await supabase
    .from("brochures")
    .select("*, seasons ( id, name, starts_on, ends_on )")
    .eq("id", brochureId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!brochure) notFound();

  const season = firstOf(
    (brochure as unknown as { seasons: SeasonRow | SeasonRow[] | null }).seasons
  );

  const [{ data: sections }, { data: entries }, { data: seasonRows }, candidates] =
    await Promise.all([
      supabase
        .from("brochure_sections")
        .select("*")
        .eq("brochure_id", brochureId)
        .order("display_order"),
      supabase
        .from("brochure_entries")
        .select("*")
        .eq("brochure_id", brochureId)
        .order("display_order"),
      supabase.from("seasons").select("id, name").eq("org_id", orgId).order("starts_on", { ascending: false }),
      getBrochureCandidates(supabase, {
        orgId,
        seasonStart: season?.starts_on ?? null,
        seasonEnd: season?.ends_on ?? null,
        brochureId,
      }),
    ]);

  const canManage =
    orgContext.membership.role === "owner" || orgContext.membership.role === "admin";

  return (
    <BrochureEditor
      brochure={brochure}
      seasonName={season?.name ?? null}
      seasons={seasonRows ?? []}
      sections={sections ?? []}
      entries={entries ?? []}
      candidates={candidates}
      canManage={canManage}
      orgId={orgId}
      orgSlug={orgContext.org.slug}
    />
  );
}

interface SeasonRow {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
