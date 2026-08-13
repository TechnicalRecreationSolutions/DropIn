import type { Metadata } from "next";
import { notFound } from "next/navigation";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import { getOrgPublicData } from "../orgPublicData";
import { notFoundMetadata } from "@/lib/seo/notFoundMetadata";
import OrgEventsClient from "./OrgEventsClient";

interface PageProps {
  params: Promise<{ orgSlug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const data = await getOrgPublicData(orgSlug);

  if (!data) return notFoundMetadata("Organization Not Found — Dropin");
  const { org } = data;

  return {
    title: `Events — ${org.name} — Dropin`,
    description: `What's happening at ${org.name}${org.city ? ` in ${org.city}` : ""}: a month-at-a-glance calendar of events across every location.`,
    openGraph: {
      title: `Events at ${org.name}`,
      description: `A month-at-a-glance calendar of events at ${org.name}.`,
    },
  };
}

/**
 * The org-wide "What's Happening" calendar — every flagged event across every
 * building the org runs, in one month view.
 *
 * Org-wide is the whole point, and it's what a facility page structurally
 * cannot do: `/facility/[slug]` is scoped to one building, so an org with a
 * pool, an arena, and a community hall had no single page showing all three.
 * This is the surface the printed sheet on the wall corresponds to.
 *
 * The layout above supplies the masthead and the org lookup (shared cache
 * entry); this page only adds the theme wrapper and the calendar itself.
 */
export default async function OrgEventsPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const data = await getOrgPublicData(orgSlug);

  // The layout already 404s on a missing org, but the page cannot assume that:
  // it renders independently and TypeScript has no way to know the layout ran.
  if (!data) notFound();
  const { org, primaryColor } = data;

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">What&rsquo;s happening</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Events across every {org.name} location. Use the print button for a page you can put
          on a wall.
        </p>
      </div>

      <OrgThemeProvider
        primaryColor={primaryColor}
        className="block rounded-xl border border-gray-200 bg-white p-3 sm:p-4"
      >
        <OrgEventsClient orgId={org.id} orgName={org.name} logoUrl={org.logo_url} />
      </OrgThemeProvider>
    </div>
  );
}
