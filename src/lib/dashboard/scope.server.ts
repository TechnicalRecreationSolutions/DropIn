import { cookies } from "next/headers";
import { FACILITY_COOKIE } from "./scope";

/**
 * The building this person last worked in, from the switcher's cookie — or
 * null. Unvalidated: always pass it through `pickFacility()` with the
 * viewer's readable buildings, which is what makes a stale id harmless.
 *
 * Reading cookies is request data, so call this inside the page's Suspense
 * boundary (the same place `searchParams` is awaited), never in its shell.
 */
export async function rememberedFacilityId(): Promise<string | null> {
  const store = await cookies();
  return store.get(FACILITY_COOKIE)?.value ?? null;
}
