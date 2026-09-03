import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

const PAGE_SIZE = 30;

const LOGGED_TABLES = [
  "facilities",
  "departments",
  "spaces",
  "schedule_groups",
  "sessions",
  "session_templates",
] as const;

/**
 * GET /api/activity — paginated activity log for the caller's org.
 *
 * Any org member can read this (see the RLS policy in 038_activity_log.sql) —
 * it's the transparency the feature exists for, not an admin-only view.
 * Reverting is gated separately, in the revert route.
 *
 * Cursor pagination on created_at rather than offset: the log is
 * insert-mostly and grows continuously, so an offset page would skip or
 * repeat rows whenever a new entry lands between two page loads.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const table = url.searchParams.get("table");
  const action = url.searchParams.get("action");
  const actor = url.searchParams.get("actor");
  const q = url.searchParams.get("q");

  let query = supabase
    .from("activity_log")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (before) query = query.lt("created_at", before);
  if (table && (LOGGED_TABLES as readonly string[]).includes(table)) {
    query = query.eq("table_name", table);
  }
  if (action === "insert" || action === "update" || action === "delete") {
    query = query.eq("action", action);
  }
  if (actor) query = query.eq("actor_email", actor);
  if (q) query = query.ilike("entity_label", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load activity." }, { status: 500 });

  const rows = data ?? [];
  const nextCursor = rows.length === PAGE_SIZE ? rows[rows.length - 1].created_at : null;

  return NextResponse.json({ entries: rows, nextCursor });
}
