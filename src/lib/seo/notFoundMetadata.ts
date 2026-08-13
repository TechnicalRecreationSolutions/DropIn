import type { Metadata } from "next";

/**
 * Metadata for a public page whose slug resolved to nothing.
 *
 * These routes answer a missing slug with **HTTP 200 and a not-found body** — a
 * soft 404. That is not an oversight and cannot be fixed where it shows:
 * `notFound()` is called correctly in every one of them, but each route sits
 * under a `loading.tsx` Suspense boundary, so the shell has already been
 * committed by the time the lookup resolves. The boundary is not optional
 * either — these routes have no `generateStaticParams`, so awaiting `params`
 * counts as request data and, without it, `next build` fails outright with
 * "uncached or runtime data during prerendering". Removing it was tried; the
 * build stops.
 *
 * What actually makes a soft 404 harmful is search engines indexing the
 * not-found page as though it were real content — a dead facility page
 * competing in results with live ones, on a product whose whole consumer
 * surface is discovery. `noindex` addresses that directly and is honoured
 * regardless of the status code.
 *
 * `follow: false` because there is nothing on the page worth crawling onward.
 *
 * If the status itself ever needs to be correct — for a link checker or an
 * uptime probe rather than a crawler — the fix is a `generateStaticParams` over
 * published slugs, which takes `params` out of request data and lets the
 * boundary go. That trades a build-time database dependency for it, which is
 * why it was not done here.
 */
export function notFoundMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
  };
}
