import type { Database } from "@/types/database.types";
import type { ScrapedProgram, ScrapedSession } from "@/lib/scraping/schemas";

type ProgramRow = Database["public"]["Tables"]["programs"]["Row"];
type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
type ConflictInsert = Database["public"]["Tables"]["scraping_conflicts"]["Insert"];

const PROGRAM_DIFF_FIELDS = [
  "name",
  "sport_category",
  "activity_type",
  "age_group",
  "skill_level",
  "max_participants",
  "cost_cents",
  "cost_notes",
  "description",
  "tags",
] as const;

const SESSION_DIFF_FIELDS = [
  "rrule",
  "dtstart",
  "dtend_time",
  "timezone",
  "valid_from",
  "valid_until",
  "location_detail",
] as const;

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function valuesDiffer(current: unknown, scraped: unknown): boolean {
  return stringifyValue(current) !== stringifyValue(scraped);
}

interface DiffInput {
  jobId: string;
  orgId: string;
  scrapedPrograms: ScrapedProgram[];
  scrapedSessions: ScrapedSession[];
  currentPrograms: ProgramRow[];
  currentSessions: SessionRow[];
}

/**
 * Pure diffing function — no DB or HTTP calls. Compares scraped entities
 * against current DB state (matched by external_id, scoped to source="scraped")
 * and returns the scraping_conflicts rows to insert.
 *
 * New entities (no existing external_id match) produce a single "_new"
 * sentinel conflict carrying the whole entity as JSON in scraped_value,
 * since a brand-new program/session isn't a per-field diff.
 */
export function diffScrapedData(input: DiffInput): ConflictInsert[] {
  const { jobId, orgId, scrapedPrograms, scrapedSessions, currentPrograms, currentSessions } = input;

  const conflicts: ConflictInsert[] = [];

  const programsByExternalId = new Map(
    currentPrograms.filter((p) => p.source === "scraped" && p.external_id).map((p) => [p.external_id as string, p])
  );

  for (const scraped of scrapedPrograms) {
    const existing = programsByExternalId.get(scraped.external_id);

    if (!existing) {
      conflicts.push({
        job_id: jobId,
        org_id: orgId,
        entity_type: "program",
        entity_id: null,
        field_name: "_new",
        current_value: null,
        scraped_value: JSON.stringify(scraped),
        resolution: null,
        resolved_by: null,
        resolved_at: null,
      });
      continue;
    }

    for (const field of PROGRAM_DIFF_FIELDS) {
      const currentValue = existing[field as keyof ProgramRow];
      const scrapedValue = scraped[field as keyof ScrapedProgram];
      if (valuesDiffer(currentValue, scrapedValue)) {
        conflicts.push({
          job_id: jobId,
          org_id: orgId,
          entity_type: "program",
          entity_id: existing.id,
          field_name: field,
          current_value: stringifyValue(currentValue),
          scraped_value: stringifyValue(scrapedValue),
          resolution: null,
          resolved_by: null,
          resolved_at: null,
        });
      }
    }
  }

  const sessionsByExternalId = new Map(
    currentSessions.filter((s) => s.source === "scraped" && s.external_id).map((s) => [s.external_id as string, s])
  );

  for (const scraped of scrapedSessions) {
    const existing = sessionsByExternalId.get(scraped.external_id);

    if (!existing) {
      conflicts.push({
        job_id: jobId,
        org_id: orgId,
        entity_type: "session",
        entity_id: null,
        field_name: "_new",
        current_value: null,
        scraped_value: JSON.stringify(scraped),
        resolution: null,
        resolved_by: null,
        resolved_at: null,
      });
      continue;
    }

    for (const field of SESSION_DIFF_FIELDS) {
      const currentValue = existing[field as keyof SessionRow];
      const scrapedValue = scraped[field as keyof ScrapedSession];
      if (valuesDiffer(currentValue, scrapedValue)) {
        conflicts.push({
          job_id: jobId,
          org_id: orgId,
          entity_type: "session",
          entity_id: existing.id,
          field_name: field,
          current_value: stringifyValue(currentValue),
          scraped_value: stringifyValue(scrapedValue),
          resolution: null,
          resolved_by: null,
          resolved_at: null,
        });
      }
    }
  }

  return conflicts;
}
