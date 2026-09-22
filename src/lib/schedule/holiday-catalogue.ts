/**
 * Suggested statutory holidays, computed per jurisdiction and year
 * (migration 059).
 *
 * THIS IS A SUGGESTION ENGINE, NOT A SOURCE OF TRUTH. Nothing here is stored
 * until a human ticks it, and every surface that shows these dates says so.
 * That framing is deliberate and load-bearing: statutory holiday rules are a
 * moving legal target across thirteen Canadian jurisdictions (and, later,
 * fifty-odd American ones), and a recreation centre's decision to actually
 * close is local regardless of what the statute says. Being wrong here costs
 * one unticked checkbox, which is the only reason it is safe to ship an
 * opinion at all.
 *
 * ACCURACY, HONESTLY STATED. British Columbia and Alberta are the provinces
 * this product currently has facilities in, and their lists were the ones
 * worth getting right. The other eleven are a good-faith starting point and
 * have NOT been verified against provincial employment standards; treat a
 * complaint about one of them as a data fix here, not a bug in the schedule.
 * `kind` carries that nuance where it exists — several days are genuinely
 * statutory in one province and merely widely-taken in another, and a centre
 * needs to see which is which before deciding.
 *
 * No dates are hard-coded per year. Everything is derived from a rule, so this
 * file does not expire and no migration ships in December.
 */

/** ISO 3166-2 subdivision codes, matching `facilities.province`. */
export type Jurisdiction =
  | "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

export const JURISDICTIONS: { code: Jurisdiction; name: string }[] = [
  { code: "AB", name: "Alberta" },
  { code: "BC", name: "British Columbia" },
  { code: "MB", name: "Manitoba" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland and Labrador" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NT", name: "Northwest Territories" },
  { code: "NU", name: "Nunavut" },
  { code: "ON", name: "Ontario" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "QC", name: "Quebec" },
  { code: "SK", name: "Saskatchewan" },
  { code: "YT", name: "Yukon" },
];

/**
 * `statutory` — a general holiday under that jurisdiction's employment
 * standards, so a centre is very likely closed or on reduced hours.
 * `common`    — widely observed or optional, but not statutory there. Offered
 *               unticked, because plenty of pools run a normal Sunday on it.
 */
export type HolidayKind = "statutory" | "common";

export interface SuggestedHoliday {
  /** Stable across years — the UI uses it to tell a suggestion apart from a
   *  saved row, and it never reaches the database. */
  id: string;
  name: string;
  /** "YYYY-MM-DD", a wall-clock calendar date with no instant meaning — the
   *  same convention as the rest of the schedule (see rrule/README.md). */
  date: string;
  kind: HolidayKind;
  /** Shown under the name when it is not self-explanatory. */
  note?: string;
}

interface HolidayRule {
  id: string;
  name: string;
  /** Per-jurisdiction status. A jurisdiction absent from this map does not
   *  observe the day at all and is never offered it. */
  jurisdictions: Partial<Record<Jurisdiction, HolidayKind>>;
  /** Some jurisdictions rename the same day. */
  namePerJurisdiction?: Partial<Record<Jurisdiction, string>>;
  date: (year: number) => Date;
  note?: string;
}

// -- date helpers -------------------------------------------------------------
// All of these build dates with Date.UTC and read them with UTC getters, the
// same no-conversion convention the schedule uses everywhere. A holiday is a
// calendar square, not an instant.

function utc(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** The nth `weekday` of a month. weekday: 0=Sunday..6=Saturday. */
function nthWeekday(year: number, month1: number, weekday: number, n: number): Date {
  const first = utc(year, month1, 1);
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month1, 1 + shift + (n - 1) * 7);
}

/** The last `weekday` strictly before a given day of the month. */
function weekdayBefore(year: number, month1: number, day: number, weekday: number): Date {
  const target = utc(year, month1, day);
  const back = ((target.getUTCDay() - weekday + 7) % 7) || 7;
  return new Date(target.getTime() - back * 86400000);
}

/**
 * Easter Sunday, Gregorian — the Anonymous/Meeus algorithm. Good Friday is
 * the only moving feast the schedule needs, but it needs Easter to find it.
 */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// -- the rules ----------------------------------------------------------------

const ALL: Jurisdiction[] = ["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"];

function everywhere(kind: HolidayKind): Partial<Record<Jurisdiction, HolidayKind>> {
  return Object.fromEntries(ALL.map((j) => [j, kind]));
}

const RULES: HolidayRule[] = [
  {
    id: "new-years-day",
    name: "New Year's Day",
    jurisdictions: everywhere("statutory"),
    date: (y) => utc(y, 1, 1),
  },
  {
    id: "family-day",
    name: "Family Day",
    // Third Monday in February in BC (since 2019), AB, ON, SK and NB. The same
    // Monday carries a different name in MB, NS and PE.
    namePerJurisdiction: {
      MB: "Louis Riel Day",
      NS: "Heritage Day",
      PE: "Islander Day",
    },
    jurisdictions: {
      AB: "statutory", BC: "statutory", ON: "statutory", SK: "statutory",
      NB: "statutory", MB: "statutory", NS: "statutory", PE: "statutory",
    },
    date: (y) => nthWeekday(y, 2, 1, 3),
  },
  {
    id: "good-friday",
    name: "Good Friday",
    jurisdictions: everywhere("statutory"),
    date: (y) => addDays(easterSunday(y), -2),
  },
  {
    id: "easter-monday",
    name: "Easter Monday",
    // Federal and QC; elsewhere a normal working Monday for most employers.
    jurisdictions: { QC: "common", NT: "common", NU: "common", YT: "common" },
    date: (y) => addDays(easterSunday(y), 1),
    note: "Not statutory in most provinces — many centres run normal hours.",
  },
  {
    id: "victoria-day",
    name: "Victoria Day",
    namePerJurisdiction: { QC: "National Patriots' Day" },
    jurisdictions: {
      AB: "statutory", BC: "statutory", MB: "statutory", ON: "statutory",
      SK: "statutory", QC: "statutory", NT: "statutory", NU: "statutory",
      YT: "statutory", NB: "common", NS: "common", PE: "common", NL: "common",
    },
    date: (y) => weekdayBefore(y, 5, 25, 1),
  },
  {
    id: "national-indigenous-peoples-day",
    name: "National Indigenous Peoples Day",
    jurisdictions: { NT: "statutory", YT: "statutory", NU: "common" },
    date: (y) => utc(y, 6, 21),
  },
  {
    id: "canada-day",
    name: "Canada Day",
    jurisdictions: everywhere("statutory"),
    date: (y) => utc(y, 7, 1),
  },
  {
    id: "nunavut-day",
    name: "Nunavut Day",
    jurisdictions: { NU: "statutory" },
    date: (y) => utc(y, 7, 9),
  },
  {
    id: "civic-holiday",
    name: "Civic Holiday",
    // First Monday in August. Statutory in only a few places despite being one
    // of the most widely-taken days of the year, which is exactly the sort of
    // thing a centre needs to decide for itself.
    namePerJurisdiction: {
      BC: "BC Day",
      SK: "Saskatchewan Day",
      NB: "New Brunswick Day",
      NS: "Natal Day",
      AB: "Heritage Day",
      MB: "Terry Fox Day",
    },
    jurisdictions: {
      BC: "statutory", SK: "statutory", NB: "statutory", NT: "statutory",
      NU: "statutory", AB: "common", MB: "common", ON: "common", NS: "common",
    },
    date: (y) => nthWeekday(y, 8, 1, 1),
  },
  {
    id: "discovery-day",
    name: "Discovery Day",
    jurisdictions: { YT: "statutory" },
    date: (y) => nthWeekday(y, 8, 1, 3),
  },
  {
    id: "labour-day",
    name: "Labour Day",
    jurisdictions: everywhere("statutory"),
    date: (y) => nthWeekday(y, 9, 1, 1),
  },
  {
    id: "truth-and-reconciliation",
    name: "National Day for Truth and Reconciliation",
    jurisdictions: {
      BC: "statutory", PE: "statutory", YT: "statutory", NT: "statutory",
      NU: "statutory", MB: "common", AB: "common", ON: "common", SK: "common",
      QC: "common", NB: "common", NS: "statutory", NL: "common",
    },
    date: (y) => utc(y, 9, 30),
  },
  {
    id: "thanksgiving",
    name: "Thanksgiving",
    jurisdictions: {
      AB: "statutory", BC: "statutory", MB: "statutory", ON: "statutory",
      SK: "statutory", QC: "statutory", NT: "statutory", NU: "statutory",
      YT: "statutory", NB: "common", NS: "common", PE: "common", NL: "common",
    },
    date: (y) => nthWeekday(y, 10, 1, 2),
  },
  {
    id: "remembrance-day",
    name: "Remembrance Day",
    jurisdictions: {
      AB: "statutory", BC: "statutory", NB: "statutory", NL: "statutory",
      NS: "statutory", PE: "statutory", SK: "statutory", NT: "statutory",
      NU: "statutory", YT: "statutory", ON: "common", MB: "common", QC: "common",
    },
    date: (y) => utc(y, 11, 11),
  },
  {
    id: "christmas-day",
    name: "Christmas Day",
    jurisdictions: everywhere("statutory"),
    date: (y) => utc(y, 12, 25),
  },
  {
    id: "boxing-day",
    name: "Boxing Day",
    jurisdictions: {
      ON: "statutory", NL: "common", AB: "common", BC: "common", MB: "common",
      NB: "common", NS: "common", PE: "common", SK: "common", QC: "common",
      NT: "common", NU: "common", YT: "common",
    },
    date: (y) => utc(y, 12, 26),
  },
];

/**
 * Every holiday worth offering a department in `jurisdiction` for `year`,
 * in date order.
 *
 * An unknown or missing jurisdiction returns the days that are statutory
 * everywhere, rather than nothing — a facility with a blank province should
 * still be offered Christmas.
 */
export function suggestedHolidays(
  jurisdiction: string | null | undefined,
  year: number
): SuggestedHoliday[] {
  const code = (jurisdiction ?? "").toUpperCase() as Jurisdiction;
  const known = ALL.includes(code);

  const out: SuggestedHoliday[] = [];
  for (const rule of RULES) {
    const kind = known
      ? rule.jurisdictions[code]
      : // Unknown jurisdiction: offer only the days that are statutory in
        // every Canadian jurisdiction, so the list is short and uncontroversial.
        (ALL.every((j) => rule.jurisdictions[j] === "statutory") ? "statutory" : undefined);
    if (!kind) continue;

    out.push({
      id: rule.id,
      name: (known && rule.namePerJurisdiction?.[code]) || rule.name,
      date: toDateString(rule.date(year)),
      kind,
      note: rule.note,
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The years the editor offers. This year and the next two — far enough ahead
 *  to plan a season, short enough that the list stays a list. */
export function selectableYears(today = new Date()): number[] {
  const y = today.getUTCFullYear();
  return [y, y + 1, y + 2];
}
