import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/session";
import { can, canReadFacility } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { fetchAnalyticsEvents, getAnalyticsSummary, getOrgEntityNames } from "@/lib/analytics/queries";
import {
  attendanceCsv,
  breakdownsCsv,
  dailyCsv,
  eventsCsv,
  summaryCsv,
  utilizationCsv,
  type ExportDataset,
} from "@/lib/analytics/csv";
import { fetchReadings } from "@/lib/analytics/attendance";
import { getUtilization } from "@/lib/analytics/utilization";
import { occupancyKindLabel } from "@/lib/sessions/occupancy";
import { parseAnalyticsRange } from "@/lib/analytics/range";

/**
 * GET /api/analytics/export — the analytics page as a spreadsheet.
 *
 * Six datasets across the section's three pages, one range, one optional
 * facility: the same inputs the pages read, so whatever is on screen is what
 * downloads. A CSV rather than a PDF because the point of an export here is a
 * number somebody can put in a board report or a budget request, not a picture
 * of the dashboard.
 *
 * ## Two permissions, matching the two gates in the section
 *
 * `summary`/`daily`/`breakdowns`/`events` are Engagement's, and stay behind
 * `analytics:view` — owner and manager. Worth saying plainly, because before
 * this route existed that permission had **no enforcement anywhere**: it was
 * declared in roles.ts and never asked.
 *
 * `utilization` and `attendance` are behind `operations:view`, which includes
 * coordinators — the same split the pages use. Gating every dataset on the
 * stricter of the two would have handed a coordinator a page whose export
 * button always 403s, which is worse than no button.
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

  const url = new URL(request.url);
  const range = parseAnalyticsRange({
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  const facilityId = url.searchParams.get("facility");
  const dataset = (url.searchParams.get("dataset") ?? "summary") as ExportDataset;

  // The gate depends on which dataset was asked for — see the header.
  const operations = dataset === "utilization" || dataset === "attendance";
  if (!can(actor, operations ? "operations:view" : "analytics:view")) {
    return NextResponse.json(
      {
        error: operations
          ? "This export is available to owners, managers and coordinators."
          : "Visitor analytics is available to owners and managers.",
      },
      { status: 403 }
    );
  }

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

  if (dataset === "utilization") {
    const data = await getUtilization(supabase, { orgId, range, facilityId });
    body = utilizationCsv(
      {
        ...data,
        byKind: data.byKind.map((k) => ({ ...k, label: occupancyKindLabel(k.kind) })),
      },
      range,
      orgName,
      facilityName
    );
  } else if (dataset === "attendance") {
    // Scoped roles get their own buildings only. RLS refuses the rest anyway;
    // this keeps the query from asking, so the row count in the file matches
    // what the page showed them.
    const { data: facilityRows } = await supabase
      .from("facilities")
      .select("id")
      .eq("org_id", orgId);
    const facilityIds = (facilityRows ?? [])
      .map((f) => f.id)
      .filter((id) => canReadFacility(actor, id));

    const [{ rows }, { data: spaceRows }] = await Promise.all([
      fetchReadings(supabase, { orgId, range, facilityId, facilityIds }),
      supabase.from("spaces").select("id, name").eq("org_id", orgId),
    ]);
    body = attendanceCsv(rows, range, orgName, facilityName, {
      facilityNames: names.facilityNames,
      spaceNames: new Map((spaceRows ?? []).map((s) => [s.id, s.name])),
    });
  } else if (dataset === "events") {
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
