import type { ScrapedProgram, ScrapedSession } from "@/lib/scraping/schemas";

/**
 * Contract for a platform-specific scraper. Implemented by the external
 * scraper service (Xplor, ActiveNet, NextRec adapters) — not invoked from
 * this app. Defined here so the webhook payload shape and future adapters
 * agree on the same normalized output.
 */
export interface PlatformAdapter {
  platform: "xplor" | "activenet" | "nextrec" | "generic";
  parse(html: string, config: { source_url: string }): Promise<{
    programs: ScrapedProgram[];
    sessions: ScrapedSession[];
  }>;
}
