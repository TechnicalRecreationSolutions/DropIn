import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarDays, MapPin, ChevronRight } from "lucide-react";
import { getOrgPublicData, getOrgFacilities } from "./orgPublicData";

interface PageProps {
  params: Promise<{ orgSlug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const data = await getOrgPublicData(orgSlug);

  if (!data) return { title: "Organization Not Found — Dropin" };
  const { org } = data;

  return {
    title: `${org.name} — Dropin`,
    description:
      org.description ??
      `Locations, schedules and events for ${org.name}${org.city ? ` in ${org.city}` : ""}.`,
  };
}

/**
 * The organization landing page — what this org publishes, and where.
 *
 * Originally a redirect to `/events`, which PPR rejected: `redirect()` on an
 * awaited param is runtime control flow, so the route could not prerender a
 * static shell and the build failed outright. A real page is the better answer
 * regardless — `/org/[slug]` is what anyone gets by truncating a printed URL,
 * and landing on a page that lists the org's buildings and its calendar is more
 * useful than being bounced.
 *
 * Kept deliberately thin: the substantial org-level surface is the brochure,
 * and that's Phase D. This lists what exists today and nothing speculative.
 */
export default async function OrgPublicIndexPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const data = await getOrgPublicData(orgSlug);

  if (!data) notFound();
  const facilities = await getOrgFacilities(data.org.id);

  return (
    <div className="space-y-6">
      <Link
        href={`/org/${orgSlug}/events`}
        className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors"
      >
        <span className="w-11 h-11 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
          <CalendarDays className="w-5 h-5 text-blue-600" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-gray-900">Event calendar</span>
          <span className="block text-sm text-gray-500">
            What&rsquo;s happening this month, across every location.
          </span>
        </span>
        <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
      </Link>

      {facilities.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-3">
            {facilities.length === 1 ? "Location" : "Locations"}
          </h2>
          <ul className="divide-y divide-gray-100">
            {facilities.map((facility) => (
              <li key={facility.id}>
                <Link
                  href={`/facility/${facility.slug}`}
                  className="flex items-center gap-3 py-3 group"
                >
                  <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                      {facility.name}
                    </span>
                    {facility.city && (
                      <span className="block text-xs text-gray-500">
                        {facility.city}
                        {facility.province ? `, ${facility.province}` : ""}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
