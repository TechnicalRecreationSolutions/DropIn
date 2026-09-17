import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { getDirectoryListings } from "@/lib/directory/listings";
import { filterFacilities } from "@/lib/directory/filter";
import { DIRECTORY_ATTRIBUTION, type DirectoryResponse } from "@/lib/directory/types";
import { SPORT_CATEGORY_IDS } from "@/lib/utils/sport-categories";

const QuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  sport: z.enum(SPORT_CATEGORY_IDS).optional(),
});

/**
 * GET /api/public/v1/directory — the facilities residents can find on Dropin.
 *
 * Public, versioned and unauthenticated; the contract is
 * src/lib/directory/types.ts and src/app/api/public/README.md.
 *
 *   ?q=      words matched against name, city, province and organization
 *   ?sport=  a SPORT_CATEGORIES id
 *
 * There is deliberately no location parameter. Every listed facility comes
 * back with its coordinates and the caller sorts by distance itself
 * (sortByDistance in src/lib/directory/filter.ts), so a resident's position
 * never reaches this server. That stops being affordable at thousands of
 * centres; see MAX_LISTINGS in listings.ts.
 *
 * Signed-in or not, every caller gets the same answer: the data comes from a
 * cookie-free, shared cache. That is what makes the public Cache-Control below
 * safe, unlike /api/sessions/expand, which has to vary it.
 */
export async function GET(request: NextRequest) {
  if (!(await checkRateLimit("directory", await getClientIp()))) {
    return rateLimitResponse("directory");
  }

  const params = request.nextUrl.searchParams;
  const parsed = QuerySchema.safeParse({
    q: params.get("q") || undefined,
    sport: params.get("sport") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  let listings;
  try {
    listings = await getDirectoryListings();
  } catch (err) {
    console.error("[directory]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "The directory is unavailable right now." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const body: DirectoryResponse = {
    apiVersion: 1,
    facilities: filterFacilities(listings, parsed.data),
    attribution: DIRECTORY_ATTRIBUTION,
  };

  return NextResponse.json(body, {
    headers: {
      // Short: a centre that opts in expects to see itself soon, and the CDN
      // copy is not expired by the save the way the server cache is.
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
