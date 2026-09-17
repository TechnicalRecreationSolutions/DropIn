/**
 * Looks up coordinates for facilities that were saved while nothing geocoded
 * them (ef0a035 → migration 052), so they can appear in "near me" results.
 *
 * Needs migration 052 applied.
 *
 * Selects facilities with `geocoded_at IS NULL` — never looked up by the
 * Nominatim geocoder. That includes rows holding coordinates from the old
 * Mapbox geocoder, which are re-checked because at least one of them is wrong
 * ("123 Test St, Calgary" was placed near the Saskatchewan border). The
 * printout shows how far each one moves.
 *
 * Dry run by default: prints what it found and writes nothing.
 *
 *   node scripts/backfill-facility-geocodes.mjs            # dry run
 *   node scripts/backfill-facility-geocodes.mjs --apply    # write lat/lng/geocoded_at
 *   node scripts/backfill-facility-geocodes.mjs --retry-not-found
 *       # also retry rows a previous run marked as not found
 *
 * The lookup mirrors src/lib/geo/geocode.ts (full address, then postal code
 * alone); keep the two in step. Requests are spaced 1.1 s apart, per
 * Nominatim's usage policy. Uses the service role: this is an operator script,
 * not a code path any user can reach.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const RETRY_NOT_FOUND = process.argv.includes("--retry-not-found");

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USER_AGENT = `Dropin/1.0 (${env.NEXT_PUBLIC_APP_URL ?? "recreation schedule publishing"}) backfill`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
async function search(params) {
  const wait = lastRequestAt + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries({ ...params, format: "jsonv2", limit: "1" })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
  const hits = await res.json();
  const lat = Number(hits[0]?.lat);
  const lng = Number(hits[0]?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function geocode(f) {
  const countrycodes = (f.country ?? "CA").toLowerCase();
  const full = await search({
    street: f.address_line1,
    city: f.city,
    state: f.province,
    postalcode: f.postal_code,
    countrycodes,
  });
  if (full) return { ...full, precision: "address" };
  if (f.postal_code?.trim()) {
    const postal = await search({ postalcode: f.postal_code, countrycodes });
    if (postal) return { ...postal, precision: "postal_code" };
  }
  return null;
}

/** Great-circle distance in km — only for the printout. */
function km(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

let query = admin
  .from("facilities")
  .select("id, name, address_line1, city, province, postal_code, country, lat, lng, geocoded_at")
  .order("name");
query = RETRY_NOT_FOUND
  ? query.or("geocoded_at.is.null,lat.is.null")
  : query.is("geocoded_at", null);

const { data: facilities, error } = await query;
if (error) {
  console.error(
    error.message.includes("geocoded_at")
      ? "facilities.geocoded_at does not exist — apply migration 052 first."
      : error.message
  );
  process.exit(1);
}

console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${facilities.length} facilit${facilities.length === 1 ? "y" : "ies"} to look up\n`);

let found = 0;
let notFound = 0;
let failed = 0;
for (const f of facilities) {
  const label = `${f.name} — ${f.address_line1}, ${f.city} ${f.province} ${f.postal_code}`;
  let hit;
  try {
    hit = await geocode(f);
  } catch (e) {
    failed++;
    console.log(`  ERROR     ${label}: ${e.message} (left untouched)`);
    continue;
  }

  const previous = f.lat !== null && f.lng !== null ? { lat: f.lat, lng: f.lng } : null;
  if (hit) {
    found++;
    const moved = previous ? ` (was ${km(previous, hit).toFixed(2)} km away)` : "";
    console.log(`  FOUND     ${label} → ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)} by ${hit.precision}${moved}`);
  } else {
    notFound++;
    console.log(`  NOT FOUND ${label}${previous ? " (old coordinates will be cleared)" : ""}`);
  }

  if (APPLY) {
    const { error: writeError } = await admin
      .from("facilities")
      .update({
        lat: hit?.lat ?? null,
        lng: hit?.lng ?? null,
        geocoded_at: new Date().toISOString(),
      })
      .eq("id", f.id);
    if (writeError) {
      failed++;
      console.log(`            write failed: ${writeError.message}`);
    }
  }
}

console.log(`\n${found} found, ${notFound} not found, ${failed} failed${APPLY ? "" : " — nothing written (pass --apply)"}`);
process.exit(failed ? 1 : 0);
