import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import { getOrgPublicData } from "../../orgPublicData";
import BrochureDocument from "@/components/brochure/BrochureDocument";

interface PageProps {
  params: Promise<{ orgSlug: string; brochureSlug: string }>;
}

/**
 * A published brochure.
 *
 * Every entry is a stored snapshot — no join back to sessions or schedule
 * groups happens here, and that is the point. What a reader sees is what was
 * assembled and published, not a live view that could differ from the printed
 * copy on someone's counter.
 *
 * RLS does the publish gating (migration 031): a draft is invisible to the
 * anonymous client, as are dismissed entries inside a published one. The
 * `status` filter below is belt-and-braces for a clearer 404 — it is not what
 * makes this safe.
 *
 * DELIBERATELY NOT `"use cache"`, unlike its sibling routes.
 *
 * The result of this query depends on `status`, which staff flip from the
 * editor. A first attempt cached it for hours and invalidated by tag on every
 * write; the verification harness caught that **unpublishing did not take
 * effect** — the withdrawn brochure went on being served. Caching would also
 * strand the opposite case, where a freshly published brochure 404s because a
 * null was cached while it was a draft.
 *
 * A publish gate is exactly the thing a cache must not sit in front of, and
 * this is a low-traffic document, so the round trip is the right price. React's
 * `cache()` still dedupes within one request, so `generateMetadata` and the page
 * share a single query set rather than doubling it.
 */
const getBrochure = cache(async (orgSlug: string, brochureSlug: string) => {
  const supabase = createPublicClient();

  const org = await getOrgPublicData(orgSlug);
  if (!org) return null;

  const { data: brochure } = await supabase
    .from("brochures")
    .select("*")
    .eq("org_id", org.org.id)
    .eq("slug", brochureSlug)
    .eq("status", "published")
    .maybeSingle();

  if (!brochure) return null;

  const [{ data: sections }, { data: entries }, { data: season }] = await Promise.all([
    supabase
      .from("brochure_sections")
      .select("id, title, blurb, display_order, layout")
      .eq("brochure_id", brochure.id)
      .order("display_order"),
    supabase
      .from("brochure_entries")
      .select("id, section_id, title, description, image_url, link_url, link_label, display_order")
      .eq("brochure_id", brochure.id)
      .eq("status", "included")
      .order("display_order"),
    brochure.season_id
      ? supabase.from("seasons").select("name, starts_on, ends_on").eq("id", brochure.season_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    org: org.org,
    orgPrimaryColor: org.primaryColor,
    brochure,
    sections: sections ?? [],
    entries: entries ?? [],
    season,
  };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, brochureSlug } = await params;
  const data = await getBrochure(orgSlug, brochureSlug);

  if (!data) return { title: "Brochure Not Found — Dropin" };
  const { brochure, org } = data;

  return {
    title: `${brochure.title} — ${org.name}`,
    description: brochure.subtitle ?? brochure.intro_copy?.slice(0, 160) ?? `Programs and events from ${org.name}.`,
    openGraph: {
      title: `${brochure.title} — ${org.name}`,
      description: brochure.subtitle ?? `Programs and events from ${org.name}.`,
      ...(brochure.cover_image_url ? { images: [brochure.cover_image_url] } : {}),
    },
  };
}

export default async function PublicBrochurePage({ params }: PageProps) {
  const { orgSlug, brochureSlug } = await params;
  const data = await getBrochure(orgSlug, brochureSlug);

  if (!data) notFound();

  return (
    <OrgThemeProvider
      // The brochure's own accent wins over the org default when set — an org
      // may theme a seasonal guide differently from its schedule widget.
      primaryColor={data.brochure.accent_color ?? data.orgPrimaryColor}
      className="block"
    >
      <BrochureDocument
        brochure={data.brochure}
        sections={data.sections}
        entries={data.entries}
        orgName={data.org.name}
        orgLogoUrl={data.org.logo_url}
        seasonLabel={data.season?.name ?? null}
      />
    </OrgThemeProvider>
  );
}
