import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { MAX_FILE_SIZE, MAX_ROWS, validateRow, type ImportRow } from "@/lib/import/rows";

/**
 * POST /api/import
 *
 * Accepts multipart/form-data with a CSV file + facilityId. Returns preview
 * rows with validation errors for the client to review before committing.
 * Actual commit happens via POST /api/import/commit.
 *
 * CSV only, deliberately. This route used to accept .xlsx/.xls through SheetJS
 * (`xlsx`), which carries an unfixed prototype-pollution advisory
 * (GHSA-4r6h-8v6p-xvw6) and a ReDoS (GHSA-5pgg-2g8v-p4x9) — the maintainers
 * moved distribution off npm, so the published package is stale and no patched
 * version is installable from there. Parsing untrusted spreadsheets with it was
 * the single highest-risk dependency in the app, so the format was dropped
 * rather than the vulnerability accepted. Staff export to CSV first; papaparse
 * has no equivalent advisory and was already a dependency. See SECURITY.md → H4.
 *
 * Security: extension/MIME check, size limit, row limit enforced during parse
 * (not after it), no exec of file content.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Parsing a 10 MB file is CPU-bound. The reader below stops at MAX_ROWS
  // rather than consuming the whole file first, so a single request is
  // bounded — but rate limiting still bounds how often that work is requested.
  if (!(await checkRateLimit("importFile", user.id))) {
    return rateLimitResponse("importFile");
  }

  const membership = await getRouteMembership(supabase, user.id);

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const facilityId = formData.get("facilityId") as string | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!facilityId) return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });

  // Checked by extension as well as MIME: browsers report CSV inconsistently
  // (text/csv, application/vnd.ms-excel, or text/plain depending on what Excel
  // has registered on the machine), so MIME alone rejects legitimate files.
  const allowed = ["text/csv", "application/vnd.ms-excel", "text/plain"];
  if (!allowed.includes(file.type) && !file.name.match(/\.csv$/i)) {
    return NextResponse.json(
      { error: "Only CSV files are supported. In Excel, use File → Save As → CSV." },
      { status: 400 }
    );
  }

  let rows: ImportRow[] = [];

  try {
    const text = await file.text();
    const Papa = await import("papaparse");
    const result = Papa.default.parse<ImportRow>(text, {
      header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      // Stop at one past the cap rather than parsing the whole file and
      // rejecting afterwards — the extra row is what makes the check below
      // able to tell "exactly at the cap" from "over it".
      preview: MAX_ROWS + 1,
    });
    rows = result.data;
  } catch {
    return NextResponse.json({ error: "Could not parse file. Ensure it is a valid CSV file." }, { status: 400 });
  }

  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `File has too many rows (max ${MAX_ROWS})` }, { status: 400 });
  }

  const preview = rows.map((row, i) => validateRow(row, i));
  const errorCount = preview.filter((r) => r._errors.length > 0).length;

  return NextResponse.json({
    preview,
    facilityId,
    orgId: membership.org_id,
    totalRows: rows.length,
    errorCount,
  });
}
