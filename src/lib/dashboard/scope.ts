/**
 * Which building the dashboard is working in — the rules shared by the
 * sidebar's building switcher (client) and every facility-scoped page
 * (server). See docs/DESIGN.md "Scope and filters" for the user-facing rule.
 *
 *   - The URL is the source of truth: `?facility=` (built by
 *     lib/schedule/commandCentreHref.ts, never by hand).
 *   - When the URL names no building, the one this person last worked in is
 *     used — remembered in a cookie (FACILITY_COOKIE).
 *   - Failing both, the first building they can read, by name.
 *
 * A cookie rather than localStorage because the server has to read it: a bare
 * `/dashboard/schedule` (the phone bottom bar, a bookmark, a redirect) then
 * renders the remembered building on the first byte, with no client-side
 * redirect or flash of the wrong one. It holds only an id and is validated
 * against the viewer's readable buildings on every read, so a stale id, or one
 * from another organization on a shared computer, simply falls through.
 *
 * Pure — no `next/headers` here, so the switcher can import it. The server
 * read is `rememberedFacilityId()` in ./scope.server.ts.
 */

import {
  commandCentreHref,
  departmentsHref,
  mapHref,
  sessionsHref,
  spacesHref,
} from "@/lib/schedule/commandCentreHref";

export const FACILITY_COOKIE = "dropin-facility";

/** A year: this is a preference, not a session. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The building in use: the URL's, else the remembered one, else the first.
 *
 * `facilities` must already be the ones this viewer can read (filter with
 * `canReadFacility` first) — otherwise a coordinator lands in a building they
 * do not hold, which is exactly what every page did before this existed.
 */
export function pickFacility<T extends { id: string }>(
  facilities: T[],
  param: string | null | undefined,
  remembered: string | null | undefined
): T | null {
  return (
    facilities.find((f) => f.id === param) ??
    facilities.find((f) => f.id === remembered) ??
    facilities[0] ??
    null
  );
}

const rememberListeners = new Set<() => void>();

/** Client only: remember the building for the next URL that names none. */
export function rememberFacility(facilityId: string) {
  if (readRememberedFacility() === facilityId) return;
  document.cookie = `${FACILITY_COOKIE}=${encodeURIComponent(facilityId)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  rememberListeners.forEach((listener) => listener());
}

/** Client only: the remembered building, if any. */
export function readRememberedFacility(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${FACILITY_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** For useSyncExternalStore: re-read when this tab remembers a new building. */
export function subscribeRememberedFacility(listener: () => void) {
  rememberListeners.add(listener);
  return () => {
    rememberListeners.delete(listener);
  };
}

/**
 * Pages that offer "All facilities" — only where it means something, and
 * only to roles that hold every building (owners and managers). Missing
 * `?facility` means "all" here, as it always has, so old links keep their
 * meaning.
 */
export function allowsAllFacilities(pathname: string): boolean {
  return pathname.startsWith("/dashboard/analytics");
}

/**
 * Where switching to another building takes you from `pathname`, or null when
 * the page is org-wide and does not read the building at all.
 *
 * Detail pages go to the same KIND of page in the new building — its list —
 * never to a URL still holding the old building's department, schedule or
 * space ids. `facilityId` null means "All facilities" (analytics only).
 */
export function facilitySwitchHref(
  pathname: string,
  search: URLSearchParams,
  facilityId: string | null
): string | null {
  if (pathname === "/dashboard") return facilityId ? `/dashboard?facility=${facilityId}` : "/dashboard";

  if (allowsAllFacilities(pathname)) {
    // Keep the period; only the building changes.
    const params = new URLSearchParams(search.toString());
    if (facilityId) params.set("facility", facilityId);
    else params.delete("facility");
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  if (!facilityId) return null;

  if (pathname.startsWith("/dashboard/schedule/deck")) return null;
  if (pathname.startsWith("/dashboard/schedule")) return commandCentreHref({ facilityId });
  if (pathname.startsWith("/dashboard/sessions")) return sessionsHref({ facilityId });
  if (pathname.startsWith("/dashboard/spaces")) return spacesHref(facilityId);
  if (pathname.startsWith("/dashboard/map")) return mapHref(facilityId);
  if (pathname.startsWith("/dashboard/departments")) return departmentsHref(facilityId);
  if (pathname === "/dashboard/status") return `/dashboard/facilities/${facilityId}/status`;

  // The legacy facility tree. `facilities/new` is org-wide (no id yet).
  const inFacility = pathname.match(/^\/dashboard\/facilities\/([^/]+)(\/.*)?$/);
  if (inFacility && inFacility[1] !== "new") {
    const rest = inFacility[2] ?? "";
    if (rest === "/status") return `/dashboard/facilities/${facilityId}/status`;
    if (rest === "/edit") return `/dashboard/facilities/${facilityId}/edit`;
    if (rest.startsWith("/spaces")) return spacesHref(facilityId);
    if (rest.startsWith("/departments") && !rest.includes("/schedule-groups")) return departmentsHref(facilityId);
    return commandCentreHref({ facilityId });
  }

  // Facilities, Settings, Widget, Conflicts, Activity, Import: org-wide.
  return null;
}

/** Whether the page at `pathname` reads the building at all (see facilitySwitchHref). */
export function isFacilityScoped(pathname: string): boolean {
  return facilitySwitchHref(pathname, new URLSearchParams(), "x") !== null;
}
