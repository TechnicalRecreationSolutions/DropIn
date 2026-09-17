import type { DirectoryFacility } from "./types";

/**
 * Search and sort helpers for the directory. Pure and client-safe: the API
 * filters with them, and the /find page sorts with them in the browser, so the
 * visitor's location never has to reach the server.
 */

/** Lowercase, accents stripped, whitespace collapsed — "Montréal" matches "montreal". */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every word of the query must appear somewhere in the facility's name, city,
 * province or organization name, so "saanich pool" finds "Saanich
 * Commonwealth Pool" and "victoria swim" does not match on "swim" alone.
 */
export function matchesQuery(facility: DirectoryFacility, query: string): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeSearch(
    [
      facility.name,
      facility.address.city,
      facility.address.province,
      facility.organization.name,
    ].join(" ")
  );
  return words.every((word) => haystack.includes(word));
}

export function filterFacilities(
  facilities: DirectoryFacility[],
  { q, sport }: { q?: string; sport?: string }
): DirectoryFacility[] {
  return facilities.filter(
    (f) =>
      (!q || matchesQuery(f, q)) &&
      (!sport || f.sports.some((s) => s.id === sport))
  );
}

/** Great-circle distance in kilometres. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Nearest first; facilities that could not be placed on the map go last, by
 * name, rather than being dropped — they are still real centres.
 */
export function sortByDistance(
  facilities: DirectoryFacility[],
  origin: { lat: number; lng: number }
): (DirectoryFacility & { distanceKm: number | null })[] {
  return facilities
    .map((f) => ({ ...f, distanceKm: f.location ? distanceKm(origin, f.location) : null }))
    .sort((a, b) => {
      if (a.distanceKm === null && b.distanceKm === null) return a.name.localeCompare(b.name);
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
}
