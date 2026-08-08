import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Globe, MapPin } from "lucide-react";
import { getOrgPublicData } from "./orgPublicData";

/**
 * The organization's public shell — masthead and breadcrumb, shared by every
 * page under `/org/[orgSlug]`.
 *
 * This is the org-level public surface the app did not have. `(public)`
 * previously only ever addressed a *facility* (`/facility/[slug]`) or the
 * platform's own directory (`/search`, `/browse`), which meant an org with
 * three buildings had no single URL representing the organization — and an
 * org-wide event calendar has nowhere to live but here. Phase D's brochure
 * (`/org/[orgSlug]/brochure/[seasonSlug]`) hangs off the same shell, which is
 * why the org lookup lives in a shared cached function rather than in the page.
 *
 * Deliberately NOT added to `PublicNav`. That nav is the platform's own
 * wayfinding — "find activities", "browse sports" — and is identical on every
 * public page; an org-specific destination in it would either be dead weight
 * for every visitor who isn't looking at that org, or a nav that changes shape
 * per route. Orgs are reached from their facility pages and from links the org
 * publishes itself.
 *
 * PRERENDERING. This layout must not `await params` itself. Cache Components is
 * enabled, and a layout sits *above* the Suspense boundary that `loading.tsx`
 * creates for the pages beneath it — so awaiting request data here blocks the
 * whole segment from prerendering a static shell and fails the build. The
 * promise is passed down into a Suspense-wrapped child instead, which is why
 * `LayoutProps` is used unawaited below.
 */
export default function OrgPublicLayout({ children, params }: LayoutProps<"/org/[orgSlug]">) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Suspense fallback={<OrgMastheadSkeleton />}>
        <OrgMasthead params={params} />
      </Suspense>

      {children}
    </div>
  );
}

async function OrgMasthead({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const data = await getOrgPublicData(orgSlug);

  if (!data) notFound();
  const { org } = data;

  return (
    <>
      <nav className="text-sm text-gray-500 mb-6">
        <Link href="/" className="hover:text-gray-700 transition-colors">
          Home
        </Link>
        <span className="mx-2">›</span>
        <span className="text-gray-900">{org.name}</span>
      </nav>

      <header className="mb-6">
        <div className="flex items-start gap-4">
          {org.logo_url && (
            // Plain <img>: logo_url is an arbitrary org-supplied URL on an
            // unknown host, which next/image cannot optimize without every
            // such host being allowlisted in next.config. Revisit in Phase C,
            // when Storage gives these a known origin.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logo_url}
              alt=""
              className="w-14 h-14 rounded-lg object-contain bg-white border border-gray-200 shrink-0"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{org.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
              {org.city && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 shrink-0" />
                  {org.city}
                  {org.province ? `, ${org.province}` : ""}
                </span>
              )}
              {org.website_url && (
                <a
                  href={org.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-blue-600 transition-colors"
                >
                  <Globe className="w-4 h-4 shrink-0" />
                  {org.website_url.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
          </div>
        </div>

        {org.description && (
          <p className="text-gray-600 text-sm mt-4 max-w-2xl">{org.description}</p>
        )}
      </header>
    </>
  );
}

function OrgMastheadSkeleton() {
  return (
    <div className="mb-6 animate-pulse" aria-hidden>
      <div className="h-4 w-32 bg-gray-100 rounded mb-6" />
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-lg bg-gray-100 shrink-0" />
        <div className="space-y-2 pt-1">
          <div className="h-7 w-56 bg-gray-100 rounded" />
          <div className="h-4 w-36 bg-gray-100 rounded" />
        </div>
      </div>
    </div>
  );
}
