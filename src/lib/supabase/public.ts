import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Cookie-free Supabase client for public, cacheable reads.
 *
 * Uses the publishable (anon) key and reads no cookies, so every caller gets
 * the same anonymous view of the data — which is what makes the result safe to
 * cache and share between visitors. RLS still applies, as the anonymous role.
 *
 * Use this inside `use cache` functions. The cookie-backed client in
 * `server.ts` cannot be used there: reading cookies is request data, which a
 * cached function is not allowed to touch, and its result would be scoped to
 * one user anyway.
 *
 * This is NOT the admin client — it has no elevated privileges. For anything
 * user-specific, keep using `server.ts`.
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
