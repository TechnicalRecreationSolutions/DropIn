import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin, Globe, Phone, Clock } from "lucide-react";
import { cacheLife, cacheTag } from "next/cache";
import { facilitySlugCacheTag, widgetConfigCacheTag } from "@/lib/cache/tags";
import { createPublicClient } from "@/lib/supabase/public";
import { notFoundMetadata } from "@/lib/seo/notFoundMetadata";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import { DEFAULT_ENABLED_FILTERS, parseEnabledFilters } from "@/lib/schedule/sessionFilters";
import OrgImage from "@/components/media/OrgImage";
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

  // Before the lookup, so a "not found" is tagged too: POST /api/facilities
  // expires this slug when a facility is published onto it or renamed to it.
  cacheTag(facilitySlugCacheTag(facilitySlug));

  const supabase = createPublicClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name, slug, address_line1, city, province, postal_code, description, website_url, phone, is_published, listed_in_directory, org_id")
    .eq("slug", facilitySlug)
    .eq("is_published", true)
    .maybeSingle();

  if (!facility) return null;

  // This entry carries the org's widget settings (colour, views, filters, print
  // button), and "hours" is far too long for a publish to take to appear here.
  // PATCH /api/widget-config expires the tag.
  cacheTag(widgetConfigCacheTag(facility.org_id));

  // Both depend only on the facility row, so they are issued together.
  const [{ data: scheduleGroups }, { data: widgetConfig }, { data: org }] = await Promise.all([
    supabase
      .from("schedule_groups")
      .select("id, name, sport_category, activity_type, cost_cents, age_group, skill_level")
      .eq("facility_id", facility.id)
      .eq("status", "published")
      .order("name"),
    // Same allowed layouts/colours as the org's embeddable widget, so the two
    // public surfaces look like one product. The org's single config row
    // (migration 045): this used to ask for *this facility's* row and, despite
    // the comment that used to sit here, fell back to nothing when there wasn't
    // one — so an org whose only row was scoped to one facility got its real
    // colour on that facility's page and stock blue on all the others.
    supabase
      .from("widget_configs")
      // `*` for the same reason as widget/[orgId]/page.tsx: a hand-applied
      // migration that hasn't landed yet must not take the public page down.
      .select("*")
      .eq("org_id", facility.org_id)
      .is("facility_id", null)
      .is("department_id", null)
      .maybeSingle(),
    // The owning org, so the breadcrumb can name it — there is no org-level
    // public route to link to (see docs/PLAN.md §3a), so this is display-only.
    supabase
      .from("organizations_public")
      .select("name, logo_url")
      .eq("id", facility.org_id)
      .maybeSingle(),
  ]);

  return { facility, scheduleGroups, widgetConfig, org };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { facilitySlug } = await params;
  const data = await getFacilityPageData(facilitySlug);

  // Titles here are bare: the root layout's `%s | Dropin` template supplies the
  // brand, and appending it again renders "… — Dropin | Dropin" in the tab.
  // openGraph carries no template, but the root layout sets `siteName: "Dropin"`,
  // so the brand is already present there too.
  if (!data) return notFoundMetadata("Facility Not Found");
  const { facility } = data;

  return {
    title: facility.name,
    alternates: { canonical: `/facility/${facility.slug}` },
    description:
      facility.description ??
      `Drop-in schedules at ${facility.name} in ${facility.city}, ${facility.province}.`,
    openGraph: {
      title: facility.name,
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
  // The same setting as the embed: an org configures its visitor filters once,
  // on the widget page, and both public surfaces honour it.
  const enabledFilters = parseEnabledFilters(widgetConfig?.enabled_filters ?? DEFAULT_ENABLED_FILTERS);
  // Likewise the Print button (migration 051). `=== true`: absent before 051 lands.
  const allowPrint = widgetConfig?.allow_print === true;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:p-0">
      {/* Breadcrumb. A listed facility leads back to the directory a resident
          most likely came from; an unlisted one is only reached from the
          centre's own site, so it keeps Home. */}
      {/* The middle crumb used to be "Facilities", pointing at the cross-org
          search index; later it linked to the org's own public page. Both are
          gone (see docs/PLAN.md §3a) — the org name is shown as plain text
          rather than left dangling as a link to nowhere. */}
      <nav className="text-sm text-muted-foreground mb-6 print:hidden">
        {facility.listed_in_directory ? (
          <Link href="/find" className="hover:text-foreground transition-colors">Find a centre</Link>
        ) : (
          <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
        )}
        <span className="mx-2">›</span>
        {org && (
          <>
            <span>{org.name}</span>
            <span className="mx-2">›</span>
          </>
        )}
        <span className="text-foreground">{facility.name}</span>
      </nav>

      <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-8 print:block">
        {/* Left: Schedule + heading */}
        <div>
          <div className="flex items-center gap-3 mb-1 print:hidden">
            {org?.logo_url && (
              <span className="relative size-10 sm:size-12 rounded-lg shrink-0 overflow-hidden border border-border bg-card">
                <OrgImage src={org.logo_url} alt={`${org.name} logo`} sizes="48px" className="object-contain" />
              </span>
            )}
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{facility.name}</h1>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm mb-4 print:hidden">
            <MapPin className="w-4 h-4 shrink-0" />
            <span>{facility.address_line1}, {facility.city}, {facility.province} {facility.postal_code}</span>
          </div>

          {facility.description && (
            <p className="text-muted-foreground text-sm mb-6 max-w-2xl print:hidden">{facility.description}</p>
          )}

          {/* Weekly schedule — client component for interactivity */}
          <OrgThemeProvider primaryColor={primaryColor} className="block rounded-xl border border-border overflow-hidden print:border-0">
            <FacilityScheduleClient
              orgId={facility.org_id}
              facilityId={facility.id}
              allowedTemplates={allowedTemplates}
              enabledFilters={enabledFilters}
              allowPrint={allowPrint}
              printSubtitle={[org?.name, facility.name].filter(Boolean).join(" · ")}
            />
          </OrgThemeProvider>
        </div>

        {/* Right sidebar: info + schedules list */}
        <aside className="mt-8 lg:mt-0 space-y-5 print:hidden">
          {/* Contact / info card */}
          <div className="bg-card rounded-xl border border-border p-5 space-y-3">
            <h2 className="font-semibold text-foreground">Information</h2>

            {facility.phone && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Phone className="w-4 h-4 shrink-0 text-muted-foreground/70" />
                <a href={`tel:${facility.phone}`} className="hover:text-blue-600 dark:hover:text-blue-300 transition-colors">
                  {facility.phone}
                </a>
              </div>
            )}

            {facility.website_url && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Globe className="w-4 h-4 shrink-0 text-muted-foreground/70" />
                <a
                  href={facility.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-blue-600 dark:hover:text-blue-300 transition-colors truncate"
                >
                  {facility.website_url.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}

            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Clock className="w-4 h-4 shrink-0 text-muted-foreground/70" />
              <span>{facility.city}, {facility.province}</span>
            </div>
          </div>

          {/* Schedules offered */}
          {scheduleGroups && scheduleGroups.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-5">
              <h2 className="font-semibold text-foreground mb-3">Schedules offered</h2>
              <ul className="space-y-2">
                {scheduleGroups.map((sg) => (
                  <li key={sg.id} className="flex items-start justify-between gap-2 text-sm">
                    <div>
                      <p className="font-medium text-foreground">{sg.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {sg.activity_type.replace("_", " ")} · {sg.sport_category}
                        {sg.age_group ? ` · ${sg.age_group.replace("_", " ")}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-foreground">
                      {sg.cost_cents === 0 ? "Free" : `$${(sg.cost_cents / 100).toFixed(2)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* A "claim this facility" CTA used to sit here. It belonged to the
              marketplace this product no longer is: a facility page exists only
              because an organization created it and is already managing it, so
              there is no unclaimed page for anyone to claim. Shown to the centre
              whose page it is, it read as though the page were someone else's. */}
        </aside>
      </div>
    </div>
  );
}
