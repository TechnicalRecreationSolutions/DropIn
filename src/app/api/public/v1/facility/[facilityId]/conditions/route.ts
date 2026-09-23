import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { createPublicClient } from "@/lib/supabase/public";
import { localUtcOffsetMinutes } from "@/lib/conditions/readings";
import type { ConditionsResponse } from "@/lib/conditions/types";

/**
 * GET /api/public/v1/facility/[facilityId]/conditions
 *
 * What is measurably true at a facility right now: the water and air
 * temperature, and how busy it is. Public, versioned, unauthenticated; the
 * contract is `src/lib/conditions/types.ts` and `src/app/api/public/README.md`.
 *
 * ## Why this is an endpoint and not part of the cached page
 *
 * Its sibling feature, facility notices, is server-rendered into the page from
 * a `cacheLife("minutes")` entry — a closure must be in the HTML. A live head
 * count must not be: a number in a server cache is a stale number wearing a
 * fresh timestamp, and the timestamp is the part people act on. So the
 * conditions block is a client component polling this, on the same footing as
 * the schedule itself. Do not "optimise" it into the page's cache.
 *
 * ## The projection happens in the database, not here
 *
 * `facility_readings` has no public read policy at all. Everything below comes
 * from `facility_public_conditions()`, a SECURITY DEFINER function that
 * applies the facility's publishing choices — and in `level` mode the exact
 * head count never leaves it. This route reshapes JSON and does not decide
 * anything, which is deliberate: a rule enforced in a route handler is a rule
 * one forgotten `select("*")` away from being broken.
 *
 * ## The offset argument
 *
 * "Usually about 35 at this time" buckets on the local weekday and hour, and
 * Postgres cannot know what local is — migration 036 removed the stored
 * timezone and every calendar surface here reads the runtime's clock. So the
 * offset goes in as an argument. `localUtcOffsetMinutes()` owns the sign.
 */

const ParamsSchema = z.object({ facilityId: z.string().uuid() });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  if (!(await checkRateLimit("facilityConditions", await getClientIp()))) {
    return rateLimitResponse("facilityConditions");
  }

  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid facility id" }, { status: 400 });
  }

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("facility_public_conditions", {
    p_facility_id: parsed.data.facilityId,
    p_utc_offset_minutes: localUtcOffsetMinutes(),
  });

  if (error) {
    console.error("[conditions]", error.message);
    // Never cached. An empty conditions block caches as "this pool has no
    // temperature", which is indistinguishable from the real answer.
    return NextResponse.json(
      { error: "Conditions are unavailable right now." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const body: ConditionsResponse = {
    apiVersion: 1,
    readings: (data ?? []).map((row) => ({
      spaceId: row.space_id,
      spaceName: row.space_name,
      metric: row.metric,
      value: row.value,
      level: row.level,
      recordedAt: row.recorded_at,
      typicalValue: row.typical_value,
    })),
  };

  return NextResponse.json(body, {
    headers: {
      // Thirty seconds. Long enough that a busy afternoon does not turn into
      // one function call per visitor per minute; short enough that the count
      // a guard just entered is on the page before they have put the phone
      // down. The client polls at 60 s, so this mostly deduplicates visitors
      // rather than delaying any of them.
      "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
