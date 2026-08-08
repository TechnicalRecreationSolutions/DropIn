import type { ReactNode } from "react";

/**
 * Shared shell for /privacy and /terms.
 *
 * The project has no typography plugin, so heading and prose styles are set
 * here once rather than repeated down two long documents — which is also what
 * keeps the two pages looking like one another as they are edited.
 */
export default function LegalDocument({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900">
        {title}
      </h1>
      <p className="mt-2 text-sm text-gray-500">Last updated {lastUpdated}</p>

      <div
        className="
          mt-8 space-y-6 text-gray-700 leading-relaxed
          [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900
          [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:scroll-mt-20
          [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-900
          [&_h3]:mt-6 [&_h3]:mb-2
          [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2
          [&_li]:marker:text-gray-400
          [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2
          [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse
          [&_th]:text-left [&_th]:font-semibold [&_th]:text-gray-900
          [&_th]:border-b [&_th]:border-gray-300 [&_th]:py-2 [&_th]:pr-4
          [&_td]:border-b [&_td]:border-gray-200 [&_td]:py-2 [&_td]:pr-4
          [&_td]:align-top
        "
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Marks a detail that must be filled in before launch — legal entity name,
 * jurisdiction, contact address. Rendered visibly rather than as a silent
 * default so an unreviewed document cannot quietly go live looking finished.
 */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <mark className="bg-amber-100 text-amber-900 px-1 rounded font-medium">
      [{children}]
    </mark>
  );
}
