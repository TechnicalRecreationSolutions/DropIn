import type { NoticeCategory, NoticeSeverity } from "@/types/app.types";

/**
 * The starting points for a facility notice.
 *
 * ## The catalogue suggests; staff decide
 *
 * Every field a preset supplies is editable the moment it is applied — the
 * headline most of all. This is the same contract as
 * `src/lib/schedule/holiday-catalogue.ts`, and for the same reason: being
 * wrong about a preset costs one edit, which is the only thing that makes it
 * safe to have an opinion at all.
 *
 * ## Why code and not a table
 *
 * Presets are vocabulary, not data. A seeded table would mean a migration
 * every time a wording improves, a re-seed for every existing organization,
 * and rows that drift as each customer edits "their" copy of a shared string.
 * Nothing here is stored; applying a preset copies its values into a new
 * `facility_notices` row and the preset is then irrelevant to it forever.
 *
 * ## Why the wording is blunt
 *
 * These render to patrons standing in a car park deciding whether to drive
 * over. "Pool closed — fecal contamination" tells them the thing they need;
 * "Aquatic facility temporarily unavailable due to a water quality event"
 * makes them phone the front desk, which is the outcome this feature exists
 * to prevent. Recreation staff say the blunt version out loud already.
 *
 * ## No preset promises a time
 *
 * Not one `body` says "we expect to reopen at". Nobody knows, least of all at
 * the moment the notice is posted, and a promise the building cannot keep is
 * worse than the closure it was meant to soften. "This normally takes several
 * hours" is as far as any of them go.
 */
export interface NoticePreset {
  /** Stable id. Used by the picker and by analytics later; never rendered. */
  id: string;
  /** The button's label in the picker — shorter than the headline. */
  label: string;
  category: NoticeCategory;
  severity: NoticeSeverity;
  /** Copied into `headline`. Under 120 characters, per the CHECK constraint. */
  headline: string;
  /** Copied into `body`. Empty string means "leave the body blank". */
  body: string;
  /**
   * Whether this preset usually names one space rather than the building.
   *
   * A hint for the form, which pre-opens the space picker for these — not a
   * rule. A contamination in a leisure pool closes that pool; a power outage
   * closes everything. Both remain changeable.
   */
  usuallyScoped: boolean;
}

export const NOTICE_PRESETS: readonly NoticePreset[] = [
  {
    id: "fecal-contamination",
    label: "Fecal / vomit contamination",
    category: "water_quality",
    severity: "closure",
    headline: "Pool closed — contamination",
    body:
      "The pool is closed while staff treat the water. This normally takes " +
      "several hours. We will reopen as soon as it is safe to swim.",
    usuallyScoped: true,
  },
  {
    id: "chemical-imbalance",
    label: "Chemical imbalance",
    category: "water_quality",
    severity: "closure",
    headline: "Pool closed — water chemistry",
    body:
      "The water is outside its safe range and the pool is closed while staff " +
      "correct it.",
    usuallyScoped: true,
  },
  {
    id: "cloudy-water",
    label: "Cloudy water (open)",
    category: "water_quality",
    severity: "caution",
    headline: "Water is cloudy — the pool is open",
    body:
      "Clarity is reduced while the filters catch up. Swimming continues and " +
      "lifeguards are on deck.",
    usuallyScoped: true,
  },
  {
    id: "filtration-fault",
    label: "Filtration / mechanical fault",
    category: "mechanical",
    severity: "closure",
    headline: "Closed — mechanical fault",
    body: "A mechanical fault has closed this space. Repairs are under way.",
    usuallyScoped: true,
  },
  {
    id: "lift-out-of-service",
    label: "Accessibility lift out of service",
    category: "mechanical",
    severity: "caution",
    headline: "Pool lift out of service",
    body:
      "The accessibility lift is out of service. Please speak to staff on " +
      "arrival about other ways into the water.",
    usuallyScoped: true,
  },
  {
    id: "lifeguard-shortage",
    label: "Lifeguard shortage",
    category: "staffing",
    severity: "closure",
    headline: "Closed — no lifeguard available",
    body:
      "We cannot safely open without a guard on deck. Today's sessions in " +
      "this space are cancelled.",
    usuallyScoped: true,
  },
  {
    id: "reduced-hours",
    label: "Reduced hours (staffing)",
    category: "staffing",
    severity: "info",
    headline: "Reduced hours today",
    body:
      "We are short-staffed today and running reduced hours. Check the " +
      "schedule below before travelling.",
    usuallyScoped: false,
  },
  {
    id: "instructor-absent",
    label: "Class cancelled — instructor away",
    category: "staffing",
    severity: "info",
    headline: "A class is cancelled today",
    body: "The instructor is unavailable. Everything else runs as scheduled.",
    usuallyScoped: false,
  },
  {
    id: "unscheduled-maintenance",
    label: "Unscheduled maintenance",
    category: "maintenance",
    severity: "closure",
    headline: "Closed for maintenance",
    body: "Unscheduled maintenance has closed this space.",
    usuallyScoped: true,
  },
  {
    id: "power-outage",
    label: "Power outage",
    category: "power",
    severity: "closure",
    headline: "Closed — power outage",
    body:
      "The building has lost power and is closed. We will post again when it " +
      "is back.",
    usuallyScoped: false,
  },
  {
    id: "weather-closure",
    label: "Weather closure",
    category: "weather",
    severity: "closure",
    headline: "Closed — weather",
    body: "The facility is closed because of the weather.",
    usuallyScoped: false,
  },
  {
    id: "air-quality",
    label: "Poor air quality",
    category: "weather",
    severity: "caution",
    headline: "Outdoor activities suspended — air quality",
    body:
      "Outdoor programming is suspended while air quality is poor. Indoor " +
      "sessions run as scheduled.",
    usuallyScoped: false,
  },
  {
    id: "at-capacity",
    label: "At capacity",
    category: "capacity",
    severity: "caution",
    headline: "At capacity — please come back later",
    body:
      "We are full and are not admitting anyone else for now. This usually " +
      "clears within the hour.",
    usuallyScoped: false,
  },
  {
    id: "blank",
    label: "Something else",
    category: "other",
    severity: "info",
    headline: "",
    body: "",
    usuallyScoped: false,
  },
];

/** A preset by id, or `undefined`. Nothing stores these ids, so a miss is fine. */
export function findPreset(id: string): NoticePreset | undefined {
  return NOTICE_PRESETS.find((p) => p.id === id);
}

// Labels, severity ranking and the "is it live?" predicate live in
// `./notices.ts` — every surface that draws a notice needs them, and only the
// picker needs these presets.
