import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type Client = SupabaseClient<Database>;

/**
 * A thing that *could* go in a brochure. Computed, never stored.
 *
 * The distinction this type carries is the whole design: a candidate is derived
 * live from flags and dates, so it changes whenever those change. The moment
 * one is pulled it becomes a `brochure_entries` row and stops being a
 * candidate — from then on nothing about the season, the flag or the source can
 * alter it. See the header of migration 031.
 */
export interface BrochureCandidate {
  sourceType: "session";
  sourceId: string;
  /** What the entry's snapshot would be titled. */
  title: string;
  description: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  /** Context for the rail — which building, and what it costs. */
  facilityName: string | null;
  costCents: number | null;
  /** Already pulled into this brochure, in either state. */
  existing: "included" | "dismissed" | null;
}

interface CandidateQuery {
  orgId: string;
  /** Restricts to sources whose own window overlaps the season. */
  seasonStart: string | null;
  seasonEnd: string | null;
  /** Existing entries in this brochure, so the rail can mark what's already handled. */
  brochureId: string;
}

/**
 * Every session flagged `in_brochure` whose dates overlap the season,
 * annotated with whether this brochure has already dealt with it.
 *
 * SESSIONS ONLY. A program (schedule_groups) has no occurrence of its own to
 * show up on a printed page or an events calendar — only its sessions do, and
 * only the ones someone chose to feature. schedule_groups carried its own
 * `in_brochure` flag until the product decision to drop it: a whole program
 * being "offered" independent of any specific, recurring session it runs
 * produced brochure entries nobody could point at a real occurrence.
 *
 * OVERLAP, NOT CONTAINMENT. A session running Sep 1 – Dec 20 is a candidate for
 * a fall season starting Sep 8, even though it began before the season did.
 * Requiring containment would drop every program that spans a boundary, which
 * is most of the recurring ones.
 *
 * A NULL season window means "no season" — everything flagged is a candidate.
 * That is a real state: an org can build a brochure before defining seasons,
 * and returning nothing there would look like the flags weren't working.
 */
export async function getBrochureCandidates(
  supabase: Client,
  { orgId, seasonStart, seasonEnd, brochureId }: CandidateQuery
): Promise<BrochureCandidate[]> {
  const [sessionRows, entryRows] = await Promise.all([
    (async () => {
      let query = supabase
        .from("sessions")
        .select(
          `id, valid_from, valid_until,
           schedule_groups ( name, cost_cents, facilities ( name ) ),
           session_features ( title, description, image_url, link_url, link_label ),
           session_templates ( name )`
        )
        .eq("org_id", orgId)
        .eq("in_brochure", true)
        .eq("is_active", true);

      // Overlap: the source starts before the season ends, and hasn't already
      // finished when the season begins. `valid_until IS NULL` means open-ended,
      // so it can never have finished.
      if (seasonEnd) query = query.lte("valid_from", seasonEnd);
      if (seasonStart) query = query.or(`valid_until.is.null,valid_until.gte.${seasonStart}`);
      return query;
    })(),

    supabase
      .from("brochure_entries")
      .select("session_id, status")
      .eq("brochure_id", brochureId)
      .not("session_id", "is", null),
  ]);

  const existingBySource = new Map<string, "included" | "dismissed">();
  for (const entry of entryRows.data ?? []) {
    if (entry.session_id) existingBySource.set(entry.session_id, entry.status);
  }

  // Relational selects — cast needed until the Supabase CLI generates types
  // with FK relations, matching the pattern in /api/sessions/expand.
  const sessions = (sessionRows.data ?? []) as unknown as SessionCandidateRow[];

  const fromSessions: BrochureCandidate[] = sessions.map((row) => {
    const feature = firstOf(row.session_features);
    return {
      sourceType: "session",
      sourceId: row.id,
      // Same fallback chain as eventDisplayTitle: an override, else the
      // template's own label, else the schedule group's name.
      title:
        feature?.title ??
        firstOf(row.session_templates)?.name ??
        row.schedule_groups?.name ??
        "Untitled",
      description: feature?.description ?? null,
      imageUrl: feature?.image_url ?? null,
      linkUrl: feature?.link_url ?? null,
      linkLabel: feature?.link_label ?? null,
      facilityName: row.schedule_groups?.facilities?.name ?? null,
      costCents: row.schedule_groups?.cost_cents ?? null,
      existing: existingBySource.get(row.id) ?? null,
    };
  });

  return fromSessions.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * PostgREST returns an embedded to-one relation as an object or a single-element
 * array depending on how it infers the relationship. `expand.ts` normalizes the
 * same way for `session_features` — the shape is not worth trusting.
 */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

interface SessionCandidateRow {
  id: string;
  valid_from: string;
  valid_until: string | null;
  schedule_groups: { name: string; cost_cents: number; facilities: { name: string } | null } | null;
  session_features:
    | {
        title: string | null;
        description: string | null;
        image_url: string | null;
        link_url: string | null;
        link_label: string | null;
      }
    | Array<{
        title: string | null;
        description: string | null;
        image_url: string | null;
        link_url: string | null;
        link_label: string | null;
      }>
    | null;
  session_templates: { name: string } | Array<{ name: string }> | null;
}
