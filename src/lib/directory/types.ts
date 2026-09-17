/**
 * The public directory's data contract — version 1.
 *
 * This is what `GET /api/public/v1/directory` returns, and the planned native
 * app will read the same shape, so treat it as published: add fields freely,
 * but renaming or removing one is a v2. See src/app/api/public/README.md.
 *
 * Client-safe: no server imports, so the /find page can share it.
 */

export interface DirectorySport {
  /** A SPORT_CATEGORIES id, e.g. "swimming". */
  id: string;
  label: string;
}

export interface DirectoryFacility {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  address: {
    line1: string;
    city: string;
    province: string;
    postalCode: string;
  };
  /**
   * Null when the address could not be placed on the map. Such a facility is
   * still listed and searchable by name or city; it just can't be sorted by
   * distance.
   */
  location: { lat: number; lng: number } | null;
  phone: string | null;
  websiteUrl: string | null;
  /** Cover photo, or null. */
  photoUrl: string | null;
  organization: { name: string; logoUrl: string | null };
  /** Sports with a published, not-yet-ended schedule, sorted by label. */
  sports: DirectorySport[];
  /** Site-relative path of the facility's public page, e.g. "/facility/panorama". */
  path: string;
}

export interface DirectoryResponse {
  apiVersion: 1;
  facilities: DirectoryFacility[];
  /** Required by OpenStreetMap's licence wherever `location` is used. */
  attribution: string;
}

export const DIRECTORY_ATTRIBUTION = "Locations © OpenStreetMap contributors";
