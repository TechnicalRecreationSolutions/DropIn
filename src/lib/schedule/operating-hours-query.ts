import type { createClient } from "@/lib/supabase/server";
import {
  groupHoursByDepartment,
  type OperatingHoursByDepartment,
  type OperatingWindow,
} from "@/lib/schedule/operating-hours";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Loads operating hours for a set of departments in one query and groups them
 * into a week each (migration 058).
 *
 * Kept apart from operating-hours.ts so that file stays pure: it is imported
 * by client components (the hours editor, the session form's summary) and
 * must not drag a server Supabase client into the browser bundle.
 *
 * Reads through RLS deliberately, with no service-role shortcut. The read
 * policy mirrors the parent department's, so an anonymous visitor gets hours
 * for published departments only — which is exactly right for the public
 * widget: a following session under a draft department should resolve to
 * nothing for that viewer, the same as the session itself does.
 */
export async function fetchOperatingHours(
  supabase: SupabaseServerClient,
  departmentIds: (string | null | undefined)[]
): Promise<OperatingHoursByDepartment> {
  const ids = Array.from(new Set(departmentIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return new Map();

  // Two queries in parallel rather than one embed: the holiday windows hang
  // off the holiday, not off the department, so PostgREST would have to nest
  // three levels and every caller would pay for it even in the common case of
  // no holidays at all.
  const [hoursResult, holidayResult] = await Promise.all([
    supabase
      .from("department_hours")
      .select("department_id, day_of_week, opens_at, closes_at")
      .in("department_id", ids),
    supabase
      .from("department_holidays")
      .select("department_id, holiday_date, observance, department_holiday_windows (opens_at, closes_at)")
      .in("department_id", ids),
  ]);

  // An empty map degrades every following session to its stored snapshot
  // times rather than emptying the schedule — the same failure direction
  // expandOccurrenceTimes takes when hours are absent. A schedule that is
  // slightly stale is recoverable; one that renders blank because a join
  // failed looks like data loss.
  if (hoursResult.error || !hoursResult.data) return new Map();

  // A holiday failure degrades further but in the same direction: the weekly
  // pattern still resolves, and the schedule shows normal hours on a day the
  // building is shut. That is wrong, and it is still better than a blank
  // schedule — and unlike a blank one it is visible to anyone looking.
  // Cast once — the generated Database types carry `Relationships: []` and so
  // do not model PostgREST embeds, the same reason conflicts.ts and the expand
  // route describe their nested shapes by hand.
  type HolidayRow = {
    department_id: string;
    holiday_date: string;
    observance: "closed" | "custom_hours" | "normal_hours";
    department_holiday_windows: { opens_at: string; closes_at: string }[] | null;
  };

  const holidayRows = (
    holidayResult.error ? [] : ((holidayResult.data ?? []) as unknown as HolidayRow[])
  );

  const holidays = holidayRows.map((h) => ({
    department_id: h.department_id,
    holiday_date: h.holiday_date,
    observance: h.observance,
    windows: h.department_holiday_windows ?? [],
  }));

  return groupHoursByDepartment(hoursResult.data, holidays);
}

/**
 * The same data as a plain object, for handing to a client component.
 *
 * A Map is not reliably serializable across the server/client boundary, and
 * the session form needs the whole org's hours up front: its schedule picker
 * can move a session to another building, and the all-day toggle has to know
 * whether the newly-picked department has hours without a round trip.
 */
export async function fetchOperatingHoursRecord(
  supabase: SupabaseServerClient,
  departmentIds: (string | null | undefined)[]
): Promise<Record<string, OperatingWindow[][]>> {
  const grouped = await fetchOperatingHours(supabase, departmentIds);
  const record: Record<string, OperatingWindow[][]> = {};
  for (const [departmentId, hours] of grouped) {
    // The recurring week only. The session form uses this to answer "does
    // this department have hours to follow?" and to summarise them; holiday
    // overrides are dates, and the form has no date to ask about — the
    // session it is building spans a season.
    record[departmentId] = hours.week.map((day) => day.map((w) => ({ ...w })));
  }
  return record;
}
