import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildRRuleString } from "@/lib/rrule/validate";

export const runtime = "nodejs"; // xlsx requires Node runtime

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS = 500;

export interface ImportRow {
  program_name: string;
  sport_category: string;
  activity_type?: string;
  days: string;         // comma-separated: Mon,Wed,Fri
  start_time: string;   // HH:MM
  end_time: string;
  season_start: string; // YYYY-MM-DD
  season_end?: string;
  cost?: string;        // dollars, e.g. "5.00"
  location_detail?: string;
}

export interface ImportPreviewRow extends ImportRow {
  _index: number;
  _errors: string[];
  _rrule: string;
}

const DAY_MAP: Record<string, string> = {
  mon: "MO", tue: "TU", wed: "WE", thu: "TH",
  fri: "FR", sat: "SA", sun: "SU",
  monday: "MO", tuesday: "TU", wednesday: "WE", thursday: "TH",
  friday: "FR", saturday: "SA", sunday: "SU",
};

function parseDays(raw: string): string[] {
  return raw.split(/[,\s]+/)
    .map((d) => DAY_MAP[d.toLowerCase().trim()])
    .filter(Boolean);
}

function validateRow(row: ImportRow, index: number): ImportPreviewRow {
  const errors: string[] = [];

  if (!row.program_name?.trim()) errors.push("program_name is required");
  if (!row.sport_category?.trim()) errors.push("sport_category is required");
  if (!row.days?.trim()) errors.push("days is required (e.g. Mon,Wed,Fri)");
  if (!row.start_time?.match(/^\d{2}:\d{2}$/)) errors.push("start_time must be HH:MM");
  if (!row.end_time?.match(/^\d{2}:\d{2}$/)) errors.push("end_time must be HH:MM");
  if (!row.season_start?.match(/^\d{4}-\d{2}-\d{2}$/)) errors.push("season_start must be YYYY-MM-DD");

  const days = parseDays(row.days ?? "");
  if (days.length === 0 && row.days) errors.push("Could not parse days — use Mon,Tue,Wed etc.");

  const rrule = days.length > 0
    ? buildRRuleString({ frequency: "weekly", days })
    : "";

  return { ...row, _index: index, _errors: errors, _rrule: rrule };
}

/**
 * POST /api/import
 *
 * Accepts multipart/form-data with a file (xlsx or csv) + facilityId.
 * Returns preview rows with validation errors for the client to review
 * before committing. Actual commit happens via POST /api/import/commit.
 *
 * Security: MIME type check, size limit, row limit, no exec of file content.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string } | null };

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const facilityId = formData.get("facilityId") as string | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!facilityId) return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });

  const allowed = ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel", "text/plain"];
  if (!allowed.includes(file.type) && !file.name.match(/\.(csv|xlsx|xls)$/i)) {
    return NextResponse.json({ error: "Only CSV and Excel files are supported" }, { status: 400 });
  }

  let rows: ImportRow[] = [];

  try {
    if (file.name.endsWith(".csv") || file.type === "text/csv") {
      const text = await file.text();
      const Papa = await import("papaparse");
      const result = Papa.default.parse<ImportRow>(text, {
        header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      });
      rows = result.data;
    } else {
      const buffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<ImportRow>(ws, { defval: "" });
      // Normalize headers
      rows = rows.map((r) => {
        const normalized: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          normalized[k.trim().toLowerCase().replace(/\s+/g, "_")] = String(v ?? "");
        }
        return normalized as unknown as ImportRow;
      });
    }
  } catch {
    return NextResponse.json({ error: "Could not parse file. Ensure it is a valid CSV or Excel file." }, { status: 400 });
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
