import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin, Globe, Phone, Clock, CalendarDays } from "lucide-react";
import { cacheLife } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { notFoundMetadata } from "@/lib/seo/notFoundMetadata";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import FacilityScheduleClient from "./FacilityScheduleClient";
import type { ScheduleTemplate } from "@/types/schedule.types";

interface PageProps {
  params: Promise<{ facilitySlug: string }>;
}

/**
 * Everything the public facility page renders, in one cached unit.
 *
 * This page is identical for every visitor, so it is cached rather than
 * re-queried per request — which is what lets the route prerender a static
 * shell instead of blocking on three round trips. Uses the cookie-free public
 * client: a cached function cannot read request data, and the anonymous RLS
 * view is exactly the public view wanted here.
 *
 * generateMetadata calls this too. Both hit the same cache entry, so the page
 * and its <head> cost one query set between them rather than two.
 */
async function getFacilityPageData(facilitySlug: string) {
  "use cache";
  cacheLife("hours");

  const supabase = createPublicClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name, slug, address_line1, city, province, postal_code, description, website_url, phone, is_published, org_id")
    .eq("slug", facilitySlug)
    .eq("is_published", true)
    .maybeSingle();

  if (!facility) return null;

  // Both depend only on the facility row, so they are issued together.
  const [{ data: scheduleGroups }, { data: widgetConfig }, { data: org }] = await Promise.all([
    supabase
      .from("schedule_groups")
      .select("id, name, sport_category, activity_type, cost_cents, age_group, skill_level")
      .eq("facility_id", facility.id)
      .eq("is_published", true)
      .order("name"),
    // Same allowed layouts/colors as the org's embeddable widget, for a
    // consistent look. Scoped to this facility's config row (falling back to
    // the org-wide default when a facility-specific row doesn't exist),
    // matching the scoping already applied in widget/[orgId]/page.tsx.
    supabase
      .from("widget_configs")
      .select("allowed_templates, primary_color")
      .eq("org_id", facility.org_id)
      .eq("facility_id", facility.id)
      .is("department_id", null)
      .maybeSingle(),
    // The owning org, so this page can point at the org-wide event calendar.
    // A facility page is one building; the events sheet spans all of them, and
    // this link is the only route a visitor has to discover that.
    supabase
      .from("organizations_public")
      .select("name, slug")
      .eq("id", facility.org_id)
      .maybeSingle(),
  ]);

  return { facility, scheduleGroups, widgetConfig, org };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { facilitySlug } = await params;
  const data = await getFacilityPageData(facilitySlug);

  if (!data) return notFoundMetadata("Facility Not Found — Dropin");
  const { facility } = data;

  return {
    title: `${facility.name} — Dropin`,
    description:
      facility.description ??
      `Drop-in schedules at ${facility.name} in ${facility.city}, ${facility.province}.`,
    openGraph: {
      title: `${facility.name} — Dropin`,
      description: `Find drop-in schedules at ${facility.name}.`,
    },
  };
}

export default async function FacilityDetailPage({ params }: PageProps) {
  const { facilitySlug } = await params;
  const data = await getFacilityPageData(facilitySlug);

  if (!data) notFound();
  const { facility, scheduleGroups, widgetConfig, org } = data;

  const allowedTemplates = widgetConfig?.allowed_templates ?? (["grid", "list", "map"] as ScheduleTemplate[]);
  const primaryColor = widgetConfig?.primary_color ?? "#0066CC";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      {/* The middle crumb used to be "Facilities", pointing at the cross-org
          search index. With that gone the owning organization is the real
          parent of a building — and the crumb is dropped entirely rather than
          left dangling when the org can't be resolved. */}
      <nav className="text-sm text-gray-500 mb-6">
        <Link href="/" className="hover:text-gray-700 transition-colors">Home</Link>
        <span className="mx-2">›</span>
        {org && (
          <>
            <Link href={`/org/${org.slug}`} className="hover:text-gray-700 transition-colors">
              {org.name}
            </Link>
            <span className="mx-2">›</span>
          </>
        )}
        <span className="text-gray-900">{facility.name}</span>
      </nav>

      <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-8">
        {/* Left: Schedule + heading */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">{facility.name}</h1>
          <div className="flex items-center gap-1.5 text-gray-500 text-sm mb-4">
            <MapPin className="w-4 h-4 shrink-0" />
            <span>{facility.address_line1}, {facility.city}, {facility.province} {facility.postal_code}</span>
          </div>

          {facility.description && (
            <p className="text-gray-600 text-sm mb-6 max-w-2xl">{facility.description}</p>
          )}

          {/* Weekly schedule — client component for interactivity */}
          <OrgThemeProvider primaryColor={primaryColor} className="block rounded-xl border border-gray-200 overflow-hidden">
            <FacilityScheduleClient facilityId={facility.id} allowedTemplates={allowedTemplates} />
          </OrgThemeProvider>
        </div>

        {/* Right sidebar: info + schedules list */}
        <aside className="mt-8 lg:mt-0 space-y-5">
          {/* Contact / info card */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Information</h2>

            {facility.phone && (
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <Phone className="w-4 h-4 shrink-0 text-gray-400" />
                <a href={`tel:${facility.phone}`} className="hover:text-blue-600 transition-colors">
                  {facility.phone}
                </a>
              </div>
            )}

            {facility.website_url && (
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <Globe className="w-4 h-4 shrink-0 text-gray-400" />
                <a
                  href={facility.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-blue-600 transition-colors truncate"
                >
                  {facility.website_url.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}

            <div className="flex items-center gap-3 text-sm text-gray-600">
              <Clock className="w-4 h-4 shrink-0 text-gray-400" />
              <span>{facility.city}, {facility.province}</span>
            </div>
          </div>

          {/* Schedules offered */}
          {scheduleGroups && scheduleGroups.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Schedules offered</h2>
              <ul className="space-y-2">
                {scheduleGroups.map((sg) => (
                  <li key={sg.id} className="flex items-start justify-between gap-2 text-sm">
                    <div>
                      <p className="font-medium text-gray-800">{sg.name}</p>
                      <p className="text-xs text-gray-500 capitalize">
                        {sg.activity_type.replace("_", " ")} · {sg.sport_category}
                        {sg.age_group ? ` · ${sg.age_group.replace("_", " ")}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-gray-700">
                      {sg.cost_cents === 0 ? "Free" : `$${(sg.cost_cents / 100).toFixed(2)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Org-wide events — the only way from a building to the whole org */}
          {org && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-1">What&rsquo;s happening</h2>
              <p className="text-xs text-gray-500 mb-3">
                Events across every {org.name} location, month by month.
              </p>
              <Link
                href={`/org/${org.slug}/events`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <CalendarDays className="w-4 h-4" />
                View event calendar
              </Link>
            </div>
          )}

          {/* CTA for orgs */}
          <div className="bg-blue-50 rounded-xl border border-blue-100 p-5 text-center">
            <p className="text-sm font-medium text-blue-900 mb-1">Are you this facility?</p>
            <p className="text-xs text-blue-700 mb-3">Claim your page to manage your schedule directly.</p>
            <a
              href="/signup"
              className="inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Claim this facility
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
