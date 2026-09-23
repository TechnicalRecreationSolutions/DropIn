import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership, toActor } from "@/lib/auth/membership";
import { canReadFacility } from "@/lib/auth/roles";
import { requirePermission } from "@/lib/auth/guard";
import { METRICS, READING_METRICS } from "@/lib/conditions/readings";
import type { ReadingMetric } from "@/types/app.types";

/**
 * Head counts and temperatures at one facility (migration 061).
 *
 * GET  — the recent log, newest first. For the input tool's "this shift" list
 *        and nothing larger; see the cap below.
 * POST — record one.
 *
 * ## Aux staff can POST here, and that is the point
 *
 * `reading:write` is the first write permission an aux staffer has ever had.
 * A head count is the observation the lifeguard is already making, and a tool
 * only a manager can use is a tool nobody uses at 6am.
 *
 * So this route must **not** be gated on `isReadOnly(role)`, which is true for
 * exactly that role. It asks the permission, then asks whether the caller
 * holds this building.
 *
 * ## No PATCH, here or anywhere
 *
 * An observation is not editable — there is no UPDATE policy on the table and
 * the `Update` type is `never`. A wrong count is corrected by recording
 * another; a mistake is deleted through `[readingId]`.
 */

const MAX_ROWS = 200;

const CreateReadingSchema = z
  .object({
    metric: z.enum(READING_METRICS),
    value: z.number().finite(),
    space_id: z.string().uuid().nullish(),
    recorded_at: z.string().datetime().optional(),
  })
  .superRefine((input, ctx) => {
    // The same bounds as the CHECK constraints, restated so the person gets a
    // sentence instead of a constraint violation. `src/lib/conditions/readings.ts`
    // holds them once; the database is still the control.
    const spec = METRICS[input.metric];
    if (input.value < spec.min || input.value > spec.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `${spec.label} must be between ${spec.min} and ${spec.max}${spec.unit ? ` ${spec.unit}` : ""}.`,
      });
    }
    if (spec.integer && !Number.isInteger(input.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `${spec.label} must be a whole number.`,
      });
    }
    // A reading stamped in the future is a typo in a datetime field, never a
    // real observation. One minute of slack for clock skew between a phone and
    // the server.
    if (input.recorded_at && new Date(input.recorded_at).getTime() > Date.now() + 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recorded_at"],
        message: "A reading cannot be recorded in the future.",
      });
    }
  });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  const { facilityId } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!canReadFacility(toActor(membership), facilityId)) {
    return NextResponse.json({ error: "That facility is not one of yours." }, { status: 403 });
  }

  const url = new URL(request.url);
  // Narrowed rather than passed through: an unknown value would filter to
  // nothing and read as "this facility has no readings", which is the wrong
  // answer to a typo'd query string.
  const metricParam = url.searchParams.get("metric");
  const metric = (READING_METRICS as readonly string[]).includes(metricParam ?? "")
    ? (metricParam as ReadingMetric)
    : null;
  const spaceId = url.searchParams.get("spaceId");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, MAX_ROWS);

  let query = supabase
    .from("facility_readings")
    .select("*")
    .eq("facility_id", facilityId)
    .eq("org_id", membership.org_id)
    .order("recorded_at", { ascending: false })
    // ⚠️ This is a RECENT LOG, not a dataset. PostgREST caps a response at
    // 1,000 rows and says nothing about it, so anything that needs a total or
    // a long period must page with `.range()` — `src/lib/analytics/attendance.ts`
    // does. Capping well under the ceiling here makes the limitation explicit
    // rather than letting a caller discover it as a wrong number.
    .limit(limit);

  if (metric) query = query.eq("metric", metric);
  // `spaceId=facility` asks for the whole-building readings specifically,
  // which `?spaceId=` (absent) cannot express — absent means "all of them".
  if (spaceId === "facility") query = query.is("space_id", null);
  else if (spaceId) query = query.eq("space_id", spaceId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Could not load readings" }, { status: 500 });
  }

  return NextResponse.json({ readings: data ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  const { facilityId } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Role first (every role passes, aux included), then the building.
  const denied = requirePermission(membership, "reading:write");
  if (denied) return denied;
  if (!canReadFacility(toActor(membership), facilityId)) {
    return NextResponse.json({ error: "That facility is not one of yours." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateReadingSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        // The first message, because this form has one value field and a list
        // of one reads as a bug.
        error: parsed.error.issues[0]?.message ?? "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Same cross-facility guard as a notice: `space_id` references `spaces`, not
  // "spaces here", so without this a count could be filed against a lane in
  // another building and quietly skew that building's average.
  if (input.space_id) {
    const { data: space } = await supabase
      .from("spaces")
      .select("id")
      .eq("id", input.space_id)
      .eq("facility_id", facilityId)
      .maybeSingle();
    if (!space) {
      return NextResponse.json({ error: "That space is not at this facility" }, { status: 400 });
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("facility_readings")
    .insert({
      facility_id: facilityId,
      org_id: membership.org_id,
      space_id: input.space_id ?? null,
      metric: input.metric,
      value: input.value,
      recorded_at: input.recorded_at ?? new Date().toISOString(),
      // Also enforced by the INSERT policy's WITH CHECK, which is what stops a
      // direct PostgREST call filing a count under somebody else's name.
      recorded_by: user.id,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not record that reading" }, { status: 400 });
  }

  // No cache tag to expire. The public conditions block is a client component
  // reading a 30-second endpoint, not a cached server render — a live number
  // in a tag-expired cache is a stale number wearing a timestamp. See
  // src/lib/status/public-notices.ts for the other half of that split.
  return NextResponse.json({ reading: data }, { status: 201 });
}
