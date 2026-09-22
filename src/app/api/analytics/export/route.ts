import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { fetchAnalyticsEvents, getAnalyticsSummary, getOrgEntityNames } from "@/lib/analytics/queries";
import {
  breakdownsCsv,
  dailyCsv,
  eventsCsv,
  summaryCsv,
  type ExportDataset,
} from "@/lib/analytics/csv";
import { parseAnalyticsRange } from "@/lib/analytics/range";

/**
 * GET /api/analytics/export — the analytics page as a spreadsheet.
 *
 * Four datasets, one range, one optional facility: the same inputs the page
 * itself reads, so whatever is on screen is what downloads. A CSV rather than
 * a PDF because the point of an export here is a number somebody can put in a
 * board report or a budget request, not a picture of the dashboard.
 *
 * Authorization is `analytics:view` — owner and manager. Worth saying plainly,
 * because until this route existed that permission had **no enforcement
 * anywhere**: it was declared in roles.ts and never asked. The page now asks
 * it too.
 *
 * Nothing here can be reached without a session, so there is no rate limit;
 * the range cap in range.ts is what bounds the work a member can ask for.
 */
export async function GET(request: Request) {
  const orgContext = await getOrgContext();
  if (!orgContext) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  if (!can(actor, "analytics:view")) {
    return NextResponse.json(
      { error: "Analytics is available to owners and managers." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const range = parseAnalyticsRange({
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  const facilityId = url.searchParams.get("facility");
  const dataset = (url.searchParams.get("dataset") ?? "summary") as ExportDataset;

  const supabase = await createClient();
  const orgId = orgContext.org.id;
  const orgName = orgContext.org.name;

  // The facility name is resolved through the org-scoped read rather than
  // trusting the query string: an id belonging to another org would otherwise
  // be echoed into the file header, and RLS would already have returned no
  // rows for it.
  const names = await getOrgEntityNames(supabase, orgId);
  const facilityName = facilityId ? (names.facilityNames.get(facilityId) ?? null) : null;
  if (facilityId && !facilityName) {
    return NextResponse.json({ error: "Unknown facility" }, { status: 404 });
  }

  let body: string;

  if (dataset === "events") {
    const { rows } = await fetchAnalyticsEvents(supabase, { orgId, range, facilityId });
    body = eventsCsv(rows, range, orgName, facilityName, names);
  } else {
    const summary = await getAnalyticsSummary(supabase, { orgId, range, facilityId });
    if (dataset === "daily") {
      body = dailyCsv(summary, orgName, facilityName);
    } else if (dataset === "breakdowns") {
      body = breakdownsCsv(summary, orgName, facilityName, names);
    } else {
      body = summaryCsv(summary, orgName, facilityName);
    }
  }

  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dropin";
  const filename = `${slug}-analytics-${dataset}-${range.from}-to-${range.to}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A download is per-member and per-moment; nothing in front of this
      // route should keep a copy of one org's numbers.
      "Cache-Control": "private, no-store",
    },
  });
}
