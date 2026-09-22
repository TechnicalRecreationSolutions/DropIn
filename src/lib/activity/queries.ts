import type { SupabaseServerClient } from "@/lib/sessions/conflicts";

/**
 * Rows read per request, and the ceiling across all of them.
 *
 * PostgREST caps a single response at the project's `max_rows` (1000 on a
 * default Supabase project) **without an error**, so the Overview's
 * `.limit(5000)` was quietly returning the first thousand rows and reporting
 * the count of those as "Activity (30d)". On a busy org the tile simply stuck
 * at a number that was not the answer to anything, and nothing about it looked
 * wrong. Paging with `.range()` is what actually reads the window.
 *
 * The ceiling keeps one page load from turning into an unbounded read. Rows
 * arrive newest-first, so hitting it drops the oldest changes rather than the
 * recent ones, and `truncated` lets the caller say "20,000+" instead of
 * passing a floor off as a total.
 */
const PAGE_SIZE = 1000;
const MAX_ROWS = 20_000;

export interface ScopeRow {
  table_name: string;
  row_id: string;
}

export interface ActivityScopeResult {
  rows: ScopeRow[];
  /** True when the read stopped at MAX_ROWS before reaching the window's start. */
  truncated: boolean;
}

/**
 * Every activity_log row for this org since `sinceIso`, newest first, as the
 * bare `(table_name, row_id)` pairs the Overview matches against its
 * facility/department/schedule id sets.
 *
 * Only the two columns, because the count is the whole point: the full rows for
 * *display* are a separate, tiny query (`fetchRecentActivity`), and asking for
 * `before`/`after` JSON across twenty thousand rows to produce one integer
 * would be the expensive way to get the same number.
 */
export async function fetchActivityScopeRows(
  supabase: SupabaseServerClient,
  { orgId, sinceIso }: { orgId: string; sinceIso: string }
): Promise<ActivityScopeResult> {
  const rows: ScopeRow[] = [];

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("activity_log")
      .select("table_name, row_id")
      .eq("org_id", orgId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    rows.push(...(data as ScopeRow[]));
    if (data.length < PAGE_SIZE) break;
  }

  return { rows, truncated: rows.length >= MAX_ROWS };
}
