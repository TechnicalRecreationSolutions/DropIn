import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Supabase admin client using the service role key.
 *
 * SECURITY: This client BYPASSES Row Level Security entirely.
 * It must only be used in trusted server-side contexts:
 *   - Stripe webhook handler (updating subscriptions)
 *   - Scraping webhook handler (writing scraped data)
 *   - Admin-only API routes
 *
 * Never import this in components, hooks, or any client-side code.
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
export function createAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
