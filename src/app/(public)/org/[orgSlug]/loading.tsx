import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streaming fallback for every page under `/org/[orgSlug]`.
 *
 * Same reason as the facility route's: no `generateStaticParams`, so the slug
 * is only known at request time and awaiting `params` counts as request data.
 * Without this boundary the route can't prerender a static shell, even though
 * the org data behind it is cached.
 *
 * Renders only the page body — the layout supplies the page container and its
 * own masthead fallback, so repeating the wrapper here would double the padding
 * during streaming.
 */
export default function OrgPublicLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-20 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
