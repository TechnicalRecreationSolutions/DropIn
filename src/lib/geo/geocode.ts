/**
 * Street address → coordinates, via OpenStreetMap's Nominatim.
 *
 * Server-only. Called from `POST /api/facilities` when a facility's address is
 * new or has changed, and mirrored in scripts/backfill-facility-geocodes.mjs
 * (which cannot import TypeScript; keep the two in step).
 *
 * Why Nominatim (chosen 2026-09-16): results may be stored, which is the whole
 * point here, and it needs no key. The obligations that come with it
 * (https://operations.osmfoundation.org/policies/nominatim/):
 *  - an identifying User-Agent, set below;
 *  - at most one request per second — the throttle below covers one server
 *    instance, and facility saves are rare enough that instances overlapping
 *    is not a practical concern at this scale;
 *  - no repeated lookups of the same thing — the route only calls this when
 *    the address differs from what was last looked up;
 *  - "© OpenStreetMap contributors" attribution wherever the data is used
 *    publicly, which is the /find page.
 *
 * The previous geocoder (Mapbox, deleted in ef0a035) accepted whatever came
 * back, and placed "123 Test St, Calgary" near the Saskatchewan border. This
 * one tries the full structured address, then the postal code alone (≈200 m,
 * fine for "near me"), and otherwise reports not_found rather than guess from
 * the city.
 */

export interface GeocodeInput {
  address_line1: string;
  city: string;
  province: string;
  postal_code: string;
  country?: string;
}

/**
 * "unavailable" is kept apart from "not_found" on purpose: an outage must not be
 * recorded as a bad address, or a timeout would wipe good coordinates and the
 * route would never retry the lookup.
 */
export type GeocodeOutcome =
  | {
      status: "found";
      lat: number;
      lng: number;
      /** Which query found it — "postal_code" means neighbourhood precision. */
      precision: "address" | "postal_code";
    }
  | { status: "not_found" }
  | { status: "unavailable" };

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 5000;

const USER_AGENT = `Dropin/1.0 (${process.env.NEXT_PUBLIC_APP_URL ?? "recreation schedule publishing"})`;

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Serializes requests from this instance at no more than one per MIN_GAP_MS. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function search(params: Record<string, string>): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries({ ...params, format: "jsonv2", limit: "1" })) {
    url.searchParams.set(k, v);
  }
  const res = await throttled(() =>
    fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
  );
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
  const hits = (await res.json()) as { lat?: string; lon?: string }[];
  const lat = Number(hits[0]?.lat);
  const lng = Number(hits[0]?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Never throws: a facility save must not fail because of this. */
export async function geocodeAddress(input: GeocodeInput): Promise<GeocodeOutcome> {
  const countrycodes = (input.country ?? "CA").toLowerCase();
  try {
    const full = await search({
      street: input.address_line1,
      city: input.city,
      state: input.province,
      postalcode: input.postal_code,
      countrycodes,
    });
    if (full) return { status: "found", ...full, precision: "address" };

    if (input.postal_code.trim()) {
      const postal = await search({ postalcode: input.postal_code, countrycodes });
      if (postal) return { status: "found", ...postal, precision: "postal_code" };
    }
  } catch {
    return { status: "unavailable" };
  }
  return { status: "not_found" };
}

/** Whether a save changes any field the coordinates were derived from. */
export function addressChanged(before: GeocodeInput, after: GeocodeInput): boolean {
  const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return (
    norm(before.address_line1) !== norm(after.address_line1) ||
    norm(before.city) !== norm(after.city) ||
    norm(before.province) !== norm(after.province) ||
    norm(before.postal_code) !== norm(after.postal_code) ||
    norm(before.country ?? "CA") !== norm(after.country ?? "CA")
  );
}
