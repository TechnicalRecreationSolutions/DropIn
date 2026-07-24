import type { PlatformAdapter } from "@/lib/scraping/platforms/types";

/**
 * Trivial adapter satisfying the PlatformAdapter interface for consistency.
 * Not a real scraper — the actual scraping happens in the external service.
 * Used only to generate fixture data for the dev-only mock endpoint.
 */
export const genericAdapter: PlatformAdapter = {
  platform: "generic",
  async parse(_html, config) {
    return {
      programs: [
        {
          external_id: "mock-existing-program-1",
          name: "Lap Swim (Updated)",
          sport_category: "swimming",
          activity_type: "drop_in",
          age_group: "All ages",
          skill_level: null,
          max_participants: 40,
          cost_cents: 600,
          cost_notes: null,
          description: "Open lane swimming — refreshed description from scrape",
          tags: ["swimming", "drop-in"],
          source_url: config.source_url,
        },
        {
          external_id: "mock-new-program-1",
          name: "Pickleball Open Play",
          sport_category: "pickleball",
          activity_type: "drop_in",
          age_group: "Adult",
          skill_level: "All levels",
          max_participants: 16,
          cost_cents: 800,
          cost_notes: null,
          description: "Newly discovered program from this scrape",
          tags: ["pickleball", "drop-in"],
          source_url: config.source_url,
        },
      ],
      sessions: [
        {
          external_id: "mock-new-session-1",
          program_external_id: "mock-new-program-1",
          rrule: "FREQ=WEEKLY;BYDAY=TU,TH",
          dtstart: new Date().toISOString(),
          dtend_time: "20:00:00",
          timezone: "America/Edmonton",
          valid_from: new Date().toISOString().slice(0, 10),
          valid_until: null,
          location_detail: "Court 2",
          source_url: config.source_url,
        },
      ],
    };
  },
};
