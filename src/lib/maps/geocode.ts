/**
 * Geocodes a street address to lat/lng using the Mapbox Geocoding API.
 * Called server-side when a facility is saved (API route or Server Action).
 *
 * Returns null if geocoding fails — the facility is still saved, just without
 * a map pin until the address is corrected and re-saved.
 */
export async function geocodeAddress(
  address: string,
  city: string,
  province: string,
  country = "CA"
): Promise<{ lat: number; lng: number } | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const query = encodeURIComponent(`${address}, ${city}, ${province}, ${country}`);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&country=${country}&types=address&limit=1`;

  try {
    const res = await fetch(url, { next: { revalidate: 86400 } }); // cache geocode results for 24h
    if (!res.ok) return null;

    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;

    const [lng, lat] = feature.center;
    return { lat, lng };
  } catch {
    return null;
  }
}
