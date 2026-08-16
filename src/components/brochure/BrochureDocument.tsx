import OrgImage from "@/components/media/OrgImage";
import { cn } from "@/lib/utils/cn";
import type { Database } from "@/types/database.types";
import PrintButton from "./PrintButton";

// Unrelated to session-time removal (dropin/docs/RESUME-timezone-removal.md):
// `published_at` is a real instant, not a session occurrence, and this
// document renders server-side (UTC in production) — see the footer comment
// below for why a fixed zone is still needed here.
const PRINT_DATE_TIMEZONE = "America/Edmonton";

type Brochure = Database["public"]["Tables"]["brochures"]["Row"];

interface Section {
  id: string;
  title: string;
  blurb: string | null;
  display_order: number;
  layout: "list" | "grid" | "feature";
}

interface Entry {
  id: string;
  section_id: string | null;
  title: string;
  description: string | null;
  image_url: string | null;
  link_url: string | null;
  link_label: string | null;
  display_order: number;
}

interface BrochureDocumentProps {
  brochure: Brochure;
  sections: Section[];
  entries: Entry[];
  orgName: string;
  orgLogoUrl: string | null;
  seasonLabel: string | null;
}

/**
 * The published brochure, on screen and on paper.
 *
 * ONE DOCUMENT, TWO MEDIA. There is no separate print view: the same markup
 * carries `@media print` rules in globals.css, so what a reader sees is what
 * comes out of the printer. A print-only route would be a second rendering of
 * the same content, free to drift — the same reasoning that kept the event
 * calendar from getting one.
 *
 * "Print-first" here means the screen layout is the constrained one. Entries are
 * sized so a section reads as a block rather than a scrolling feed, sections
 * avoid breaking across pages, and nothing depends on hover or interaction to
 * make sense. Browser "Save as PDF" is the deliverable, not a fallback — no
 * server-side PDF library earns its weight for a document this shape.
 *
 * A server component: it takes no interaction beyond the print button, which is
 * its own tiny client island.
 */
export default function BrochureDocument({
  brochure,
  sections,
  entries,
  orgName,
  orgLogoUrl,
  seasonLabel,
}: BrochureDocumentProps) {
  const bySection = new Map<string, Entry[]>();
  const unfiled: Entry[] = [];
  for (const entry of entries) {
    if (!entry.section_id) {
      unfiled.push(entry);
      continue;
    }
    const list = bySection.get(entry.section_id);
    if (list) list.push(entry);
    else bySection.set(entry.section_id, [entry]);
  }

  const renderedSections = sections.filter((s) => (bySection.get(s.id) ?? []).length > 0);

  return (
    <article className="brochure max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Cover */}
      <header className="brochure-cover mb-8">
        <div className="flex items-center gap-3 mb-4">
          {orgLogoUrl && (
            <span className="relative w-12 h-12 shrink-0 block">
              <OrgImage src={orgLogoUrl} alt="" sizes="48px" className="object-contain" />
            </span>
          )}
          <p className="text-sm font-semibold text-gray-500">{orgName}</p>
        </div>

        {brochure.cover_image_url && (
          <div className="relative w-full aspect-[21/9] rounded-xl overflow-hidden mb-5 bg-gray-100">
            <OrgImage
              src={brochure.cover_image_url}
              alt=""
              sizes="(max-width: 896px) 100vw, 896px"
              className="object-cover"
            />
          </div>
        )}

        <h1
          className="text-3xl sm:text-4xl font-bold text-gray-900 border-b-4 pb-3"
          style={{ borderColor: "var(--org-primary)" }}
        >
          {brochure.title}
        </h1>
        {(brochure.subtitle || seasonLabel) && (
          <p className="text-base text-gray-600 mt-2">
            {brochure.subtitle}
            {brochure.subtitle && seasonLabel ? " · " : ""}
            {seasonLabel}
          </p>
        )}

        {brochure.intro_copy && (
          <p className="text-sm text-gray-700 mt-4 max-w-2xl whitespace-pre-line">
            {brochure.intro_copy}
          </p>
        )}

        <div className="no-print mt-5">
          <PrintButton />
        </div>
      </header>

      {/* A section with nothing in it is a heading with no content — on paper
          that reads as a mistake, so it is dropped rather than printed empty.
          Resolved up front because the unfiled block below needs to know
          whether any heading actually precedes it. */}
      {renderedSections.map((section) => {
        const sectionEntries = bySection.get(section.id) ?? [];

        return (
          <section key={section.id} className="brochure-section mb-8">
            <h2
              className="text-xl font-bold text-gray-900 pb-1.5 border-b-2"
              style={{ borderColor: "var(--org-accent, #2563eb)" }}
            >
              {section.title}
            </h2>
            {section.blurb && <p className="text-sm text-gray-600 mt-1.5">{section.blurb}</p>}

            <div
              className={cn(
                "mt-3",
                section.layout === "grid"
                  ? "grid grid-cols-1 sm:grid-cols-2 gap-4"
                  : section.layout === "feature"
                    ? "space-y-5"
                    : "space-y-3"
              )}
            >
              {sectionEntries.map((entry) => (
                <EntryBlock key={entry.id} entry={entry} layout={section.layout} />
              ))}
            </div>
          </section>
        );
      })}

      {/* Entries never filed into a section still belong in the document —
          dropping them would silently lose content someone pulled in.

          They need a heading of their own whenever a real section precedes
          them. Without one they sit directly under the previous section's
          heading and are read as part of it: on a printed guide, an open gym
          left unfiled after an "Aquatics" section becomes an aquatics
          programme, which is worse than either dropping it or labelling it.
          When nothing else is sectioned there is no heading to be captured by,
          and the document is simply a list — a bare label there would be
          noise. "Unfiled" is editor vocabulary and deliberately not used. */}
      {unfiled.length > 0 && (
        <section className="brochure-section mb-8">
          {renderedSections.length > 0 && (
            <h2
              className="text-xl font-bold text-gray-900 pb-1.5 border-b-2"
              style={{ borderColor: "var(--org-accent, #2563eb)" }}
            >
              More programs
            </h2>
          )}

          <div className="mt-3 space-y-3">
            {unfiled.map((entry) => (
              <EntryBlock key={entry.id} entry={entry} layout="list" />
            ))}
          </div>
        </section>
      )}

      <footer className="brochure-footer text-xs text-gray-400 border-t border-gray-200 pt-3 mt-8">
        {orgName}
        {/* Formatted in an explicit zone. `published_at` is an instant and this
            document renders on the server, which is UTC in production — so
            `toLocaleDateString(undefined, …)` printed the UTC date. Anything
            published after 6pm local then claimed to be published *tomorrow*,
            on a document whose whole purpose is to be printed and handed out.
            Measured, not assumed: a brochure published 2026-08-12 at 23:23
            local printed "August 13, 2026".

            PRINT_DATE_TIMEZONE is a fixed placeholder, not derived from any
            per-org setting — none exists. An org genuinely outside it needs
            its own timezone column, and that is the point at which this
            should read it. */}
        {brochure.published_at
          ? ` · published ${new Intl.DateTimeFormat("en-US", {
              timeZone: PRINT_DATE_TIMEZONE,
              year: "numeric",
              month: "long",
              day: "numeric",
            }).format(new Date(brochure.published_at))}`
          : ""}
      </footer>
    </article>
  );
}

function EntryBlock({ entry, layout }: { entry: Entry; layout: Section["layout"] }) {
  const isFeature = layout === "feature";

  return (
    <div
      className={cn(
        "brochure-entry",
        isFeature ? "sm:flex sm:gap-4" : "flex gap-3",
        layout === "grid" && "flex-col"
      )}
    >
      {entry.image_url && (
        <div
          className={cn(
            "relative shrink-0 rounded-lg overflow-hidden bg-gray-100",
            isFeature ? "w-full sm:w-48 aspect-video mb-3 sm:mb-0" : layout === "grid" ? "w-full aspect-video mb-2" : "w-20 h-20"
          )}
        >
          <OrgImage src={entry.image_url} alt="" sizes="200px" className="object-cover" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-gray-900">{entry.title}</h3>
        {entry.description && (
          <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-line">{entry.description}</p>
        )}
        {entry.link_url && (
          <a
            href={entry.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium mt-1 hover:underline"
            style={{ color: "var(--org-text-on-tint, #2563eb)" }}
          >
            {entry.link_label ?? "Learn more"}
            {/* The URL is printed alongside the label, because a hyperlink on
                paper is a dead end otherwise. Hidden on screen, where the link
                is clickable and the raw URL is just noise. */}
            <span className="print-only-url hidden text-gray-500 font-normal">
              {" "}
              ({entry.link_url.replace(/^https?:\/\//, "")})
            </span>
          </a>
        )}
      </div>
    </div>
  );
}
